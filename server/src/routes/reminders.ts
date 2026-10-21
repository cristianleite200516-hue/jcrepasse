import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { getIO } from "../lib/events";

export const remindersRouter = Router();
remindersRouter.use(requireAuth);

const leadSelect = {
  id: true,
  name: true,
  phone: true,
  vehicleBrand: true,
  vehicleModel: true,
  vehicleYear: true,
  vehicleInfo: true,
} as const;

remindersRouter.get("/", async (req, res) => {
  const { leadId, status } = req.query as { leadId?: string; status?: string };
  const reminders = await prisma.reminder.findMany({
    where: {
      ...(leadId ? { leadId } : {}),
      ...(status === "pending" ? { done: false } : {}),
      ...(status === "done" ? { done: true } : {}),
    },
    include: { lead: { select: leadSelect } },
    orderBy: { dueAt: "asc" },
  });
  res.json(reminders);
});

const createSchema = z.object({
  leadId: z.string().min(1),
  dueAt: z.string().min(1),
  note: z.string().optional(),
});

remindersRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const lead = await prisma.lead.findUnique({ where: { id: parsed.data.leadId } });
  if (!lead) return res.status(404).json({ error: "Lead não encontrado" });

  const reminder = await prisma.reminder.create({
    data: {
      leadId: parsed.data.leadId,
      dueAt: new Date(parsed.data.dueAt),
      note: parsed.data.note,
    },
    include: { lead: { select: leadSelect } },
  });

  getIO().emit("reminder:created", reminder);
  res.status(201).json(reminder);
});

const updateSchema = z.object({
  dueAt: z.string().optional(),
  note: z.string().nullable().optional(),
  done: z.boolean().optional(),
});

remindersRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const reminder = await prisma.reminder.update({
    where: { id: req.params.id },
    data: {
      ...(parsed.data.dueAt ? { dueAt: new Date(parsed.data.dueAt) } : {}),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
      ...(parsed.data.done !== undefined ? { done: parsed.data.done } : {}),
    },
    include: { lead: { select: leadSelect } },
  });

  getIO().emit("reminder:updated", reminder);
  res.json(reminder);
});

remindersRouter.delete("/:id", async (req, res) => {
  await prisma.reminder.delete({ where: { id: req.params.id } });
  getIO().emit("reminder:deleted", { id: req.params.id });
  res.status(204).end();
});
