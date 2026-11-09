import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";

// Histórico de veículos: o que foi pago, o que foi gasto e por quanto foi vendido.
// Só Admin — são os mesmos números da Rentabilidade.
export const vehiclesRouter = Router();
vehiclesRouter.use(requireAuth, requireAdmin);

const include = {
  expenses: { orderBy: [{ date: "asc" as const }, { createdAt: "asc" as const }] },
  lead: { select: { id: true, name: true } },
};

// "" ou null limpa a data; "AAAA-MM-DD" vira meio-dia UTC pra não pular de dia no fuso do Brasil.
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
  const vehicle = await prisma.vehicle.create({
    data: { model: parsed.data.model.trim(), ...vehicleData(parsed.data) },
    include,
  });
  res.status(201).json(vehicle);
});

vehiclesRouter.patch("/:id", async (req, res) => {
  const parsed = vehicleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const exists = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
  if (!exists) return res.status(404).json({ error: "Veículo não encontrado" });
  const vehicle = await prisma.vehicle.update({
    where: { id: req.params.id },
    data: vehicleData(parsed.data),
    include,
  });
  res.json(vehicle);
});

vehiclesRouter.delete("/:id", async (req, res) => {
  await prisma.vehicle.deleteMany({ where: { id: req.params.id } });
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
  res.status(201).json(await prisma.vehicle.findUnique({ where: { id: req.params.id }, include }));
});

vehiclesRouter.delete("/:id/expenses/:expenseId", async (req, res) => {
  await prisma.vehicleExpense.deleteMany({ where: { id: req.params.expenseId, vehicleId: req.params.id } });
  res.json(await prisma.vehicle.findUnique({ where: { id: req.params.id }, include }));
});
