import { prisma } from "./prisma";

// Consultas do painel do dia (página Rotina) — também usadas no resumo diário enviado pelo WhatsApp.
// O processo roda no horário de Brasília (ENV TZ no Dockerfile), então "hoje"/"amanhã" usam a hora local.

const leadSummarySelect = {
  id: true,
  name: true,
  phone: true,
  status: true,
  vehicleInfo: true,
  vehicleBrand: true,
  vehicleModel: true,
  vehicleYear: true,
} as const;

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function dayKey(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

// Mesmo critério da fila "Precisa de mim" do painel de conversas: o lead está esperando e a IA não
// vai responder sozinha (desligada, pausada pela equipe ou 10+ min sem resposta).
const NEEDS_ME_WAIT_MS = 10 * 60 * 1000;

export async function getNeedsMe(limit = 8) {
  const now = Date.now();
  const conversations = await prisma.conversation.findMany({
    where: { lead: { status: { not: "PERDIDO" }, phone: { not: "status@broadcast" } } },
    include: { lead: { select: leadSummarySelect }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const waiting = conversations
    .filter((c) => {
      const last = c.messages[0];
      if (!last || last.sender !== "LEAD") return false;
      const aiActive = c.aiEnabled && (!c.aiPausedUntil || c.aiPausedUntil.getTime() <= now);
      return !aiActive || now - last.createdAt.getTime() >= NEEDS_ME_WAIT_MS;
    })
    .sort((a, b) => a.messages[0].createdAt.getTime() - b.messages[0].createdAt.getTime());
  return {
    count: waiting.length,
    items: waiting.slice(0, limit).map((c) => ({
      lead: c.lead,
      waitingSince: c.messages[0].createdAt,
      lastMessage: c.messages[0].content.slice(0, 160),
    })),
  };
}

// Qualificados que já mandaram foto: o que falta é a decisão do dono (tem interesse ou não).
export async function getToDecide(limit = 30) {
  const leads = await prisma.lead.findMany({
    where: { status: "QUALIFICADO", attachments: { some: { category: "FOTO" } } },
    select: {
      ...leadSummarySelect,
      askingPrice: true,
      urgency: true,
      notes: true,
      score: true,
      attachments: {
        where: { category: "FOTO" },
        orderBy: { createdAt: "desc" },
        select: { id: true, mimeType: true, createdAt: true },
        take: 8,
      },
    },
  });
  const qualifiedWithoutPhotos = await prisma.lead.count({
    where: { status: "QUALIFICADO", attachments: { none: { category: "FOTO" } } },
  });
  const sorted = leads.sort(
    (a, b) => (b.attachments[0]?.createdAt.getTime() ?? 0) - (a.attachments[0]?.createdAt.getTime() ?? 0)
  );
  return {
    count: sorted.length,
    qualifiedWithoutPhotos,
    items: sorted.slice(0, limit).map(({ attachments, ...lead }) => ({
      ...lead,
      photos: attachments.map((a) => ({ id: a.id, mimeType: a.mimeType })),
      lastPhotoAt: attachments[0]?.createdAt ?? null,
    })),
  };
}

export async function getAgenda() {
  const today = startOfDay(new Date());
  const appointments = await prisma.appointment.findMany({
    where: { scheduledAt: { gte: today, lt: addDays(today, 2) }, status: { not: "CANCELADO" } },
    orderBy: { scheduledAt: "asc" },
    include: { lead: { select: leadSummarySelect } },
  });
  const tomorrow = addDays(today, 1);
  return {
    today: appointments.filter((a) => a.scheduledAt < tomorrow),
    tomorrow: appointments.filter((a) => a.scheduledAt >= tomorrow),
  };
}

export async function getFollowUps() {
  const reminders = await prisma.reminder.findMany({
    where: { done: false, dueAt: { lt: addDays(startOfDay(new Date()), 1) } },
    orderBy: { dueAt: "asc" },
    include: { lead: { select: leadSummarySelect } },
    take: 30,
  });
  const settings = await prisma.settings.findUnique({
    where: { id: "singleton" },
    select: { weeklyFollowUpRunOn: true },
  });
  return { reminders, lastWeeklyRunOn: settings?.weeklyFollowUpRunOn ?? null };
}

export function leadTitle(lead: {
  name: string | null;
  phone: string;
  vehicleInfo: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
}) {
  const vehicle =
    [lead.vehicleBrand, lead.vehicleModel, lead.vehicleYear].filter(Boolean).join(" ") ||
    lead.vehicleInfo?.split(",")[0]?.trim() ||
    "";
  return [lead.name, vehicle].filter(Boolean).join(" · ") || lead.phone;
}

// Leads em aberto cuja conversa está parada há `days` dias ou mais, pra página Parados organizar a
// retomada. `lastFrom` diz quem falou por último: LEAD = ele escreveu e ninguém respondeu (urgente),
// senão fomos nós e ele sumiu (candidato a "ainda tem o veículo à venda?").
export async function getStalledLeads(days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const conversations = await prisma.conversation.findMany({
    where: {
      lead: {
        status: { notIn: ["PERDIDO", "GANHO", "FECHADO"] },
        phone: { not: "status@broadcast" },
        appointments: { none: { scheduledAt: { gte: new Date() }, status: { not: "CANCELADO" } } },
      },
    },
    include: {
      lead: {
        select: {
          ...leadSummarySelect,
          phone2: true,
          areaCode: true,
          askingPrice: true,
          urgency: true,
          score: true,
          fipeValue: true,
        },
      },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const items = conversations
    .filter((c) => c.messages[0] && c.messages[0].createdAt < cutoff)
    .map((c) => {
      const last = c.messages[0];
      return {
        lead: c.lead,
        lastMessageAt: last.createdAt,
        lastFrom: last.sender as "LEAD" | "AI" | "AGENT",
        lastMessage: last.content.slice(0, 140),
        followUpAttempts: c.followUpAttempts,
        daysStalled: Math.floor((Date.now() - last.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
      };
    })
    .sort((a, b) => b.lead.score - a.lead.score || a.lastMessageAt.getTime() - b.lastMessageAt.getTime());

  return { count: items.length, items };
}

function normalizeText(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const SOLD_PATTERNS = [
  /\bja vendi\b/,
  /\bvendi (o|a|meu|minha|esse|essa)? ?(carro|moto|veiculo|automovel|caminhao|caminhonete|camionete|van|onibus|utilitario)\b/,
  /\bvendi (ele|ela|ontem|hoje|semana passada|mes passado)\b/,
  /\b(ja )?(foi|esta|ta|estava) vendid[oa]\b/,
  /\b(carro|moto|veiculo|caminhao) (ja )?(foi )?vendid[oa]\b/,
  /\bvendid[oa] (ja|ontem|hoje|semana)\b/,
];

// Mensagem do lead dizendo que o veículo já foi vendido. Ignora negações ("ainda não vendi",
// "não foi vendido") olhando as palavras logo antes do trecho encontrado.
export function saysAlreadySold(content: string) {
  const text = normalizeText(content);
  for (const pattern of SOLD_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const before = text.slice(Math.max(0, match.index - 25), match.index);
    if (/\b(nao|nunca|ainda nao|sem)\b/.test(before)) continue;
    return true;
  }
  return false;
}

// Leads (fora Ganho/Fechado — "vendi pra vocês" não conta) que disseram que já venderam o veículo.
export async function getSoldCandidates() {
  const messages = await prisma.message.findMany({
    where: {
      sender: "LEAD",
      conversation: {
        lead: { status: { notIn: ["GANHO", "FECHADO"] }, purchasePrice: null, phone: { not: "status@broadcast" } },
      },
    },
    orderBy: { createdAt: "desc" },
    include: { conversation: { include: { lead: { select: { ...leadSummarySelect, askingPrice: true } } } } },
  });

  const byLead = new Map<string, { lead: (typeof messages)[number]["conversation"]["lead"]; message: string; at: Date }>();
  for (const m of messages) {
    if (byLead.has(m.conversation.leadId) || !saysAlreadySold(m.content)) continue;
    byLead.set(m.conversation.leadId, { lead: m.conversation.lead, message: m.content.slice(0, 200), at: m.createdAt });
  }
  const items = [...byLead.values()];
  return { count: items.length, items };
}

// Leads em aberto que sumiram: nossa mensagem foi a última (ou nunca responderam) há `days` dias ou mais,
// sem visita futura. Fora quem está em Proposta (negociação) e quem escreveu por último (esperando a gente).
export async function getArchivableStalled(days: number) {
  const { items } = await getStalledLeads(days);
  return items.filter(
    (it) => it.lastFrom !== "LEAD" && ["NOVO", "CONTATADO", "QUALIFICADO"].includes(it.lead.status)
  );
}

export async function getLostLeads() {
  const leads = await prisma.lead.findMany({
    where: { status: "PERDIDO", phone: { not: "status@broadcast" } },
    select: { ...leadSummarySelect, lossReason: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  return { count: leads.length, items: leads };
}
