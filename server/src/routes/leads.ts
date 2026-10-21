import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireAdmin, AuthedRequest } from "../middleware/auth";
import { getIO } from "../lib/events";
import { generateAdCopy } from "../ai/attendant";

// Fica dentro de .wwebjs_auth (montado no volume persistente do Railway) de propósito: uma
// pasta "uploads" separada, fora do volume, é recriada vazia a cada deploy — as fotos e
// documentos que os leads mandam somem sozinhos sem nenhum aviso.
const UPLOADS_DIR = path.join(__dirname, "..", "..", ".wwebjs_auth", "uploads");
const SIGNATURES_DIR = path.join(UPLOADS_DIR, "signatures");

// Campos cuja mudança vale registrar no log de auditoria — os demais (notas, dados de
// documento, etc.) mudam com frequência demais pra valer a pena rastrear.
const AUDITED_FIELDS = ["status", "purchasePrice", "salePrice", "assignedToId", "lossReason", "resaleStatus"] as const;

export const leadsRouter = Router();
leadsRouter.use(requireAuth);

leadsRouter.get("/", async (req, res) => {
  const { status, q, brand, minValue, maxValue, dateFrom, dateTo } = req.query as {
    status?: string;
    q?: string;
    brand?: string;
    minValue?: string;
    maxValue?: string;
    dateFrom?: string;
    dateTo?: string;
  };

  const min = minValue ? Number(minValue) : undefined;
  const max = maxValue ? Number(maxValue) : undefined;

  const leads = await prisma.lead.findMany({
    where: {
      ...(status ? { status: status as any } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { phone: { contains: q } },
            ],
          }
        : {}),
      ...(brand ? { vehicleBrand: { contains: brand } } : {}),
      ...(min !== undefined || max !== undefined
        ? { purchasePrice: { ...(min !== undefined ? { gte: min } : {}), ...(max !== undefined ? { lte: max } : {}) } }
        : {}),
      ...(dateFrom || dateTo
        ? {
            createdAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59`) } : {}),
            },
          }
        : {}),
    },
    include: {
      assignedTo: { select: { id: true, name: true } },
      appointments: {
        where: { scheduledAt: { gte: new Date() }, status: { not: "CANCELADO" } },
        orderBy: { scheduledAt: "asc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json(leads.map(({ appointments, ...lead }) => ({ ...lead, nextAppointment: appointments[0] ?? null })));
});

function normalizeName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // acentos (marcas de combinação após NFD)
    .replace(/[^\p{L}\p{N} ]/gu, "") // emojis, símbolos, pontuação
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Detecta leads prováveis duplicados pelo nome (normalizado, sem emoji/acento/pontuação) —
const ROUTINE_LEAD_SELECT = {
  id: true,
  name: true,
  phone: true,
  status: true,
  vehicleInfo: true,
  vehicleBrand: true,
  vehicleModel: true,
} as const;

// Junta tudo que precisa de atenção humana num único lugar, triado por estágio em vez de
// ordem de chegada: (a) visita já agendada pela IA, só confirmar/preparar; (b) IA respondeu
// mas o cliente sumiu, precisa de um toque humano; (c) cliente mandou mensagem e ninguém
// respondeu ainda (IA falhou ou está desligada) — a lista mais urgente das três.
leadsRouter.get("/routine", async (_req, res) => {
  const STALLED_HOURS = 24;
  const UNCONFIRMED_HOURS = 24;
  const now = new Date();
  const stalledCutoff = new Date(now.getTime() - STALLED_HOURS * 60 * 60 * 1000);
  const unconfirmedCutoff = new Date(now.getTime() - UNCONFIRMED_HOURS * 60 * 60 * 1000);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const conversations = await prisma.conversation.findMany({
    where: { lead: { phone: { not: "status@broadcast" } } },
    include: {
      lead: { select: ROUTINE_LEAD_SELECT },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const needsHumanReply: any[] = [];
  const awaitingEngagement: any[] = [];

  for (const c of conversations) {
    const last = c.messages[0];
    if (!last) continue;
    if (last.sender === "LEAD") {
      needsHumanReply.push({ ...c.lead, lastMessageAt: last.createdAt.toISOString() });
    } else if (last.createdAt < stalledCutoff) {
      awaitingEngagement.push({ ...c.lead, lastMessageAt: last.createdAt.toISOString() });
    }
  }
  needsHumanReply.sort((a, b) => a.lastMessageAt.localeCompare(b.lastMessageAt));
  awaitingEngagement.sort((a, b) => a.lastMessageAt.localeCompare(b.lastMessageAt));

  const upcomingAppointments = await prisma.appointment.findMany({
    where: { scheduledAt: { gte: now }, status: { in: ["AGENDADO", "CONFIRMADO"] } },
    include: { lead: { select: ROUTINE_LEAD_SELECT } },
    orderBy: { scheduledAt: "asc" },
  });
  const scheduledVisits = upcomingAppointments.map((a) => ({
    ...a.lead,
    appointmentId: a.id,
    scheduledAt: a.scheduledAt.toISOString(),
    appointmentStatus: a.status,
  }));

  const unconfirmedAppointments = upcomingAppointments
    .filter((a) => a.status === "AGENDADO" && a.createdAt < unconfirmedCutoff)
    .map((a) => ({
      ...a.lead,
      appointmentId: a.id,
      scheduledAt: a.scheduledAt.toISOString(),
    }));

  const [scheduledTodayCount, lastLeadMessage] = await Promise.all([
    prisma.appointment.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.message.findFirst({ where: { sender: "LEAD" }, orderBy: { createdAt: "desc" } }),
  ]);

  res.json({
    needsHumanReply,
    awaitingEngagement,
    scheduledVisits,
    unconfirmedAppointments,
    stats: {
      scheduledTodayCount,
      stalledCount: awaitingEngagement.length,
      needsReplyCount: needsHumanReply.length,
      lastLeadMessageAt: lastLeadMessage?.createdAt.toISOString() ?? null,
    },
  });
});

// comum quando o mesmo contato aparece duas vezes no WhatsApp (uma via LID, outra via número
// direto) e cada vez vira um lead novo no CRM em vez de atualizar o existente.
leadsRouter.get("/duplicates", async (_req, res) => {
  const leads = await prisma.lead.findMany({
    where: { name: { not: null } },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      vehicleInfo: true,
      vehicleBrand: true,
      vehicleModel: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map<string, typeof leads>();
  for (const lead of leads) {
    const key = normalizeName(lead.name!);
    if (key.length < 3) continue; // nomes curtos demais dão falso positivo (ex: só um emoji)
    const group = groups.get(key);
    if (group) group.push(lead);
    else groups.set(key, [lead]);
  }

  const duplicates = Array.from(groups.values())
    .filter((group) => group.length > 1)
    .sort((a, b) => b.length - a.length);

  res.json(duplicates);
});

leadsRouter.get("/:id", async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: {
      assignedTo: { select: { id: true, name: true } },
      conversation: {
        include: {
          messages: { orderBy: { createdAt: "asc" }, include: { attachment: true } },
        },
      },
    },
  });
  if (!lead) return res.status(404).json({ error: "Lead não encontrado" });
  res.json(lead);
});

leadsRouter.get("/:id/audit-log", async (req, res) => {
  const entries = await prisma.auditLog.findMany({
    where: { leadId: req.params.id },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(entries);
});

const updateLeadSchema = z.object({
  name: z.string().optional(),
  phone: z.string().min(6).optional(),
  email: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  status: z.enum(["NOVO", "CONTATADO", "QUALIFICADO", "PROPOSTA", "GANHO", "FECHADO", "PERDIDO"]).optional(),
  lossReason: z.string().nullable().optional(),
  resaleStatus: z.enum(["EM_ESTOQUE", "ANUNCIADO", "NEGOCIANDO", "VENDIDO"]).optional(),
  purchasedBy: z.string().nullable().optional(),
  soldBy: z.string().nullable().optional(),
  channel: z.enum(["TRAFEGO_PAGO", "INDICACAO", "OUTRO"]).nullable().optional(),
  score: z.number().int().min(0).max(100).optional(),
  notes: z.string().optional(),
  vehicleInfo: z.string().optional(),
  askingPrice: z.string().optional(),
  urgency: z.string().optional(),
  assignedToId: z.string().nullable().optional(),
  vehicleBrand: z.string().nullable().optional(),
  vehicleModel: z.string().nullable().optional(),
  vehicleYear: z.string().nullable().optional(),
  vehicleKm: z.number().int().nullable().optional(),
  fipeValue: z.string().nullable().optional(),
  fipeCode: z.string().nullable().optional(),
  purchasePrice: z.number().nullable().optional(),
  salePrice: z.number().nullable().optional(),
  fineDebts: z.number().nullable().optional(),
  ipvaDebt: z.number().nullable().optional(),
  otherExpenses: z.number().nullable().optional(),
  prepCost: z.number().nullable().optional(),

  addressComplement: z.string().nullable().optional(),
  cep: z.string().nullable().optional(),
  cpf: z.string().nullable().optional(),
  rg: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  profession: z.string().nullable().optional(),
  phone2: z.string().nullable().optional(),

  vehiclePlate: z.string().nullable().optional(),
  vehicleChassi: z.string().nullable().optional(),
  vehicleRenavam: z.string().nullable().optional(),
  vehicleColor: z.string().nullable().optional(),
  vehicleFuel: z.string().nullable().optional(),
  vehicleCategory: z.string().nullable().optional(),
  vehicleSituation: z.string().nullable().optional(),
  vehicleCity: z.string().nullable().optional(),
  vehicleState: z.string().nullable().optional(),
  vehicleLienBank: z.string().nullable().optional(),

  buyerName: z.string().nullable().optional(),
  buyerCpf: z.string().nullable().optional(),
  buyerRg: z.string().nullable().optional(),
  buyerNationality: z.string().nullable().optional(),
  buyerProfession: z.string().nullable().optional(),
  buyerPhone: z.string().nullable().optional(),
  buyerEmail: z.string().nullable().optional(),
  buyerAddress: z.string().nullable().optional(),
  buyerNeighborhood: z.string().nullable().optional(),
  buyerCep: z.string().nullable().optional(),
  buyerCity: z.string().nullable().optional(),
  buyerState: z.string().nullable().optional(),

  saleOperationalFee: z.number().nullable().optional(),
  saleAssumedDebts: z.number().nullable().optional(),
  deliveryDate: z.string().nullable().optional(),
  deliveryTime: z.string().nullable().optional(),
  deliveryManual: z.boolean().optional(),
  deliveryKey: z.boolean().optional(),
  deliveryProcuracao: z.boolean().optional(),
  deliveryDut: z.boolean().optional(),
  witness1Name: z.string().nullable().optional(),
  witness1Cpf: z.string().nullable().optional(),
  witness2Name: z.string().nullable().optional(),
  witness2Cpf: z.string().nullable().optional(),
});

leadsRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = updateLeadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.deliveryDate !== undefined) {
    data.deliveryDate = parsed.data.deliveryDate ? new Date(parsed.data.deliveryDate) : null;
  }

  // Snapshot de antes da mudança, usado tanto pro closedAt/soldAt quanto pro log de auditoria.
  const before = await prisma.lead.findUnique({
    where: { id: req.params.id },
    select: {
      status: true,
      purchasePrice: true,
      salePrice: true,
      assignedToId: true,
      lossReason: true,
      resaleStatus: true,
    },
  });

  // Mesma lógica do closedAt, mas pro pipeline de revenda: marca quando o carro é
  // vendido a um comprador, limpa se voltar de VENDIDO por engano.
  if (parsed.data.resaleStatus && before) {
    if (before.resaleStatus !== "VENDIDO" && parsed.data.resaleStatus === "VENDIDO") {
      data.soldAt = new Date();
    } else if (before.resaleStatus === "VENDIDO" && parsed.data.resaleStatus !== "VENDIDO") {
      data.soldAt = null;
    }
  }

  // Mantém closedAt em dia para os comparativos mensais: marca quando o lead
  // vira FECHADO pela primeira vez (negócio 100% concluído — pagamento e
  // documentação prontos), e limpa se ele sair de FECHADO depois.
  if (parsed.data.status && before) {
    if (before.status !== "FECHADO" && parsed.data.status === "FECHADO") {
      data.closedAt = new Date();
    } else if (before.status === "FECHADO" && parsed.data.status !== "FECHADO") {
      data.closedAt = null;
    }
  }

  if (parsed.data.phone) {
    const existing = await prisma.lead.findUnique({ where: { phone: parsed.data.phone } });
    if (existing && existing.id !== req.params.id) {
      return res.status(409).json({ error: "Já existe um lead com esse telefone" });
    }
  }

  const lead = await prisma.lead.update({
    where: { id: req.params.id },
    data,
    include: { assignedTo: { select: { id: true, name: true } } },
  });

  if (before) {
    const entries = AUDITED_FIELDS.filter(
      (field) => field in parsed.data && String((before as any)[field] ?? "") !== String((lead as any)[field] ?? "")
    ).map((field) => ({
      leadId: lead.id,
      userId: req.user?.id ?? null,
      field,
      oldValue: (before as any)[field] != null ? String((before as any)[field]) : null,
      newValue: (lead as any)[field] != null ? String((lead as any)[field]) : null,
    }));
    if (entries.length > 0) {
      await prisma.auditLog.createMany({ data: entries });
    }
  }

  getIO().emit("lead:updated", lead);
  res.json(lead);
});

leadsRouter.post("/", async (req, res) => {
  const schema = z.object({
    name: z.string().optional(),
    phone: z.string().min(6),
    source: z.string().optional(),
    email: z.union([z.string().email(), z.literal("")]).optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.lead.findUnique({ where: { phone: parsed.data.phone } });
  if (existing) return res.status(409).json({ error: "Já existe um lead com esse telefone" });

  const lead = await prisma.lead.create({
    data: {
      name: parsed.data.name,
      phone: parsed.data.phone,
      source: parsed.data.source ?? "manual",
      email: parsed.data.email || undefined,
      address: parsed.data.address,
      city: parsed.data.city,
      state: parsed.data.state,
      conversation: { create: {} },
    },
  });

  getIO().emit("lead:created", lead);
  res.status(201).json(lead);
});

// Veículo adicionado direto no estoque (leilão, troca, etc — não veio de um lead que
// escreveu no WhatsApp), sem telefone real. Usamos um identificador sintético único só
// pra satisfazer a coluna phone (única no banco); nunca é usado pra enviar mensagem.
const stockSchema = z.object({
  name: z.string().optional(),
  vehicleBrand: z.string().min(1),
  vehicleModel: z.string().optional(),
  vehicleYear: z.string().optional(),
  vehicleColor: z.string().optional(),
  purchasePrice: z.number().nullable().optional(),
  notes: z.string().optional(),
});

leadsRouter.post("/stock", async (req, res) => {
  const parsed = stockSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const label = [parsed.data.vehicleBrand, parsed.data.vehicleModel, parsed.data.vehicleColor]
    .filter(Boolean)
    .join(" ");
  const phone = `estoque-${crypto.randomUUID()}`;

  const lead = await prisma.lead.create({
    data: {
      name: parsed.data.name || `Estoque — ${label}`,
      phone,
      source: "estoque",
      status: "FECHADO",
      resaleStatus: "EM_ESTOQUE",
      vehicleBrand: parsed.data.vehicleBrand,
      vehicleModel: parsed.data.vehicleModel,
      vehicleYear: parsed.data.vehicleYear,
      vehicleColor: parsed.data.vehicleColor,
      vehicleInfo: label,
      purchasePrice: parsed.data.purchasePrice,
      notes: parsed.data.notes,
      closedAt: new Date(),
      conversation: { create: {} },
    },
  });

  getIO().emit("lead:created", lead);
  res.status(201).json(lead);
});

leadsRouter.post("/:id/generate-ad", async (req, res) => {
  try {
    const ad = await generateAdCopy(req.params.id);
    res.json(ad);
  } catch (err) {
    console.error("Erro ao gerar anúncio:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Falha ao gerar anúncio" });
  }
});

// Apaga o lead e TUDO relacionado a ele (conversa, mensagens, anexos, agendamentos, lembretes,
// documentos assinados, log de auditoria) — irreversível. Só admin pode fazer isso.
leadsRouter.delete("/:id", requireAdmin, async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: { conversation: true, attachments: true, signatures: true },
  });
  if (!lead) return res.status(404).json({ error: "Lead não encontrado" });

  if (lead.conversation) {
    await prisma.message.deleteMany({ where: { conversationId: lead.conversation.id } });
  }

  await prisma.$transaction([
    ...(lead.conversation ? [prisma.conversation.delete({ where: { id: lead.conversation.id } })] : []),
    prisma.attachment.deleteMany({ where: { leadId: lead.id } }),
    prisma.documentSignature.deleteMany({ where: { leadId: lead.id } }),
    prisma.appointment.deleteMany({ where: { leadId: lead.id } }),
    prisma.reminder.deleteMany({ where: { leadId: lead.id } }),
    prisma.auditLog.deleteMany({ where: { leadId: lead.id } }),
    prisma.lead.delete({ where: { id: lead.id } }),
  ]);

  for (const a of lead.attachments) {
    fs.unlink(path.join(UPLOADS_DIR, a.filename), () => {});
  }
  for (const s of lead.signatures) {
    fs.unlink(path.join(SIGNATURES_DIR, s.pdfFile), () => {});
  }

  getIO().emit("lead:deleted", { id: lead.id });
  res.status(204).end();
});
