import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { applyAppointmentTzFix, previewAppointmentTzFix } from "../lib/appointmentTzFix";
import { applyAppointmentDedupe, previewAppointmentDedupe } from "../lib/appointmentDedupe";
import { getIO } from "../lib/events";

export const appointmentsRouter = Router();
appointmentsRouter.use(requireAuth);

const leadSelect = {
  id: true,
  name: true,
  phone: true,
  vehicleBrand: true,
  vehicleModel: true,
  vehicleYear: true,
  vehicleInfo: true,
  phone2: true,
  areaCode: true,
} as const;

// Correção única das visitas que a IA agendou com 3h a menos (bug de fuso, ver appointmentTzFix).
appointmentsRouter.get("/tz-fix/preview", requireAdmin, async (_req, res) => {
  res.json(await previewAppointmentTzFix());
});

appointmentsRouter.post("/tz-fix", requireAdmin, async (_req, res) => {
  res.json(await applyAppointmentTzFix());
});

// Limpeza dos duplicados criados pela IA (cancela, não apaga).
appointmentsRouter.get("/dedupe/preview", requireAdmin, async (_req, res) => {
  res.json(await previewAppointmentDedupe());
});

appointmentsRouter.post("/dedupe", requireAdmin, async (_req, res) => {
  res.json(await applyAppointmentDedupe());
});

appointmentsRouter.get("/", async (req, res) => {
  const { from, to, leadId } = req.query as { from?: string; to?: string; leadId?: string };
  const appointments = await prisma.appointment.findMany({
    where: {
      ...(leadId ? { leadId } : {}),
      ...(from || to
        ? {
            scheduledAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    include: { lead: { select: leadSelect } },
    orderBy: { scheduledAt: "asc" },
  });
  res.json(appointments);
});

const createSchema = z.object({
  leadId: z.string().min(1),
  scheduledAt: z.string().min(1),
  notes: z.string().optional(),
});

appointmentsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const lead = await prisma.lead.findUnique({ where: { id: parsed.data.leadId } });
  if (!lead) return res.status(404).json({ error: "Lead não encontrado" });

  const appointment = await prisma.appointment.create({
    data: {
      leadId: parsed.data.leadId,
      scheduledAt: new Date(parsed.data.scheduledAt),
      notes: parsed.data.notes,
    },
    include: { lead: { select: leadSelect } },
  });

  getIO().emit("appointment:created", appointment);
  res.status(201).json(appointment);
});

const updateSchema = z.object({
  scheduledAt: z.string().optional(),
  status: z.enum(["AGENDADO", "CONFIRMADO", "REALIZADO", "CANCELADO"]).optional(),
  notes: z.string().nullable().optional(),
});

appointmentsRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const appointment = await prisma.appointment.update({
    where: { id: req.params.id },
    data: {
      ...(parsed.data.scheduledAt ? { scheduledAt: new Date(parsed.data.scheduledAt) } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
    },
    include: { lead: { select: leadSelect } },
  });

  getIO().emit("appointment:updated", appointment);
  res.json(appointment);
});

appointmentsRouter.delete("/:id", async (req, res) => {
  await prisma.appointment.delete({ where: { id: req.params.id } });
  getIO().emit("appointment:deleted", { id: req.params.id });
  res.status(204).end();
});
