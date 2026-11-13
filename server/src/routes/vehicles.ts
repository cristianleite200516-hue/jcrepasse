import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { getIO } from "../lib/events";
import { syncLeadFromVehicle } from "../lib/vehicleSync";

// Histórico de veículos: o que foi pago, o que foi gasto e por quanto foi vendido.
// Só Admin — são os mesmos números da Rentabilidade.
export const vehiclesRouter = Router();
vehiclesRouter.use(requireAuth, requireAdmin);

const include = {
  expenses: { orderBy: [{ date: "asc" as const }, { createdAt: "asc" as const }] },
  lead: { select: { id: true, name: true } },
};

// "" ou null limpa a data; "AAAA-MM-DD" vira meio-dia UTC pra não pular de dia no fuso do Brasil.
// Leva o que mudou no Histórico pro lead (Estoque, Rentabilidade, Painel) e avisa as telas abertas.
// Erro aqui não pode impedir o lançamento no Histórico.
async function pushToLead(vehicleId: string, createIfMissing = false) {
  try {
    const r = await syncLeadFromVehicle(vehicleId, { createIfMissing });
    if (r) getIO().emit(r.created ? "lead:created" : "lead:updated", r.lead);
  } catch (err) {
    console.error("Erro ao levar o carro do Histórico pro lead/Estoque:", err);
  }
}

function toDate(v: string | null | undefined) {
  if (v === undefined) return undefined;
  if (!v) return null;
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v);
}

vehiclesRouter.get("/", async (_req, res) => {
  const vehicles = await prisma.vehicle.findMany({
    include,
    orderBy: [{ purchaseDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  res.json(vehicles);
});

const money = z.number().min(0).nullable().optional();
const vehicleSchema = z.object({
  plate: z.string().nullable().optional(),
  model: z.string().min(1),
  km: z.number().int().min(0).nullable().optional(),
  year: z.string().nullable().optional(),
  purchaseDate: z.string().nullable().optional(),
  saleDate: z.string().nullable().optional(),
  purchasePrice: money,
  salePrice: money,
  notes: z.string().nullable().optional(),
});

function vehicleData(d: Partial<z.infer<typeof vehicleSchema>>) {
  return {
    ...(d.plate !== undefined ? { plate: d.plate?.trim().toUpperCase() || null } : {}),
    ...(d.model !== undefined ? { model: d.model.trim() } : {}),
    ...(d.km !== undefined ? { km: d.km } : {}),
    ...(d.year !== undefined ? { year: d.year || null } : {}),
    ...(d.purchaseDate !== undefined ? { purchaseDate: toDate(d.purchaseDate) } : {}),
    ...(d.saleDate !== undefined ? { saleDate: toDate(d.saleDate) } : {}),
    ...(d.purchasePrice !== undefined ? { purchasePrice: d.purchasePrice } : {}),
    ...(d.salePrice !== undefined ? { salePrice: d.salePrice } : {}),
    ...(d.notes !== undefined ? { notes: d.notes || null } : {}),
  };
}

vehiclesRouter.post("/", async (req, res) => {
  const parsed = vehicleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const created = await prisma.vehicle.create({
    data: { model: parsed.data.model.trim(), ...vehicleData(parsed.data) },
  });
  // Carro novo no Histórico entra no Estoque (ou em Vendidos, se já tem data de venda).
  await pushToLead(created.id, true);
  res.status(201).json(await prisma.vehicle.findUnique({ where: { id: created.id }, include }));
});

vehiclesRouter.patch("/:id", async (req, res) => {
  const parsed = vehicleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const exists = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
  if (!exists) return res.status(404).json({ error: "Veículo não encontrado" });
  const updated = await prisma.vehicle.update({ where: { id: req.params.id }, data: vehicleData(parsed.data) });
  // Carro antigo sem lead (ex: da planilha) só ganha lead se ainda não foi vendido.
  await pushToLead(updated.id, !updated.saleDate);
  res.json(await prisma.vehicle.findUnique({ where: { id: updated.id }, include }));
});

vehiclesRouter.delete("/:id", async (req, res) => {
  const vehicle = await prisma.vehicle.findUnique({ where: { id: req.params.id }, include: { lead: { select: { id: true, source: true } } } });
  await prisma.vehicle.deleteMany({ where: { id: req.params.id } });
  // Carro só de estoque (sem cliente/conversa de verdade) sai do Estoque junto. Lead de cliente fica.
  if (vehicle?.lead?.source === "estoque") {
    const leadId = vehicle.lead.id;
    const conv = await prisma.conversation.findUnique({ where: { leadId } });
    if (conv) await prisma.message.deleteMany({ where: { conversationId: conv.id } });
    await prisma.$transaction([
      ...(conv ? [prisma.conversation.delete({ where: { id: conv.id } })] : []),
      prisma.attachment.deleteMany({ where: { leadId } }),
      prisma.documentSignature.deleteMany({ where: { leadId } }),
      prisma.appointment.deleteMany({ where: { leadId } }),
      prisma.reminder.deleteMany({ where: { leadId } }),
      prisma.auditLog.deleteMany({ where: { leadId } }),
      prisma.lead.delete({ where: { id: leadId } }),
    ]);
    getIO().emit("lead:deleted", { id: leadId });
  }
  res.status(204).end();
});

const expenseSchema = z.object({
  date: z.string().nullable().optional(),
  description: z.string().optional(),
  category: z.string().nullable().optional(),
  amount: z.number(),
});

vehiclesRouter.post("/:id/expenses", async (req, res) => {
  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const exists = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
  if (!exists) return res.status(404).json({ error: "Veículo não encontrado" });
  await prisma.vehicleExpense.create({
    data: {
      vehicleId: req.params.id,
      date: toDate(parsed.data.date) ?? null,
      description: parsed.data.description?.trim() || parsed.data.category || "Gasto",
      category: parsed.data.category || null,
      amount: parsed.data.amount,
    },
  });
  await pushToLead(req.params.id);
  res.status(201).json(await prisma.vehicle.findUnique({ where: { id: req.params.id }, include }));
});

vehiclesRouter.delete("/:id/expenses/:expenseId", async (req, res) => {
  await prisma.vehicleExpense.deleteMany({ where: { id: req.params.expenseId, vehicleId: req.params.id } });
  await pushToLead(req.params.id);
  res.json(await prisma.vehicle.findUnique({ where: { id: req.params.id }, include }));
});
