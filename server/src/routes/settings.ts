import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { getIO } from "../lib/events";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get("/", async (_req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  res.json(
    settings ?? { id: "singleton", aiSystemPrompt: "", businessInfo: "", dailyClosingGoal: null, aiPaused: false }
  );
});

// Interruptor geral da IA — separado do PUT completo pra poder ligar/desligar com um clique,
// sem precisar reenviar o formulário inteiro de configurações.
settingsRouter.patch("/ai-pause", requireAdmin, async (req, res) => {
  const parsed = z.object({ aiPaused: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const settings = await prisma.settings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", aiSystemPrompt: "", businessInfo: "", aiPaused: parsed.data.aiPaused },
    update: { aiPaused: parsed.data.aiPaused },
  });
  getIO().emit("settings:updated", settings);
  res.json(settings);
});

const schema = z.object({
  aiSystemPrompt: z.string(),
  businessInfo: z.string(),
  dailyClosingGoal: z.number().int().min(0).nullable().optional(),
  storeName: z.string().nullable().optional(),
  storeAddress: z.string().nullable().optional(),
  storeLat: z.number().nullable().optional(),
  storeLng: z.number().nullable().optional(),
  // Número (DDI+DDD) que recebe o resumo diário, o follow-up semanal e os avisos do auditor.
  auditPhone: z.string().regex(/^\d{10,15}$/).nullable().optional(),
});

// Respostas rápidas da equipe — qualquer usuário logado usa e edita (não só admin), já que são
// ferramenta do dia a dia do atendimento.
const quickRepliesSchema = z.object({
  quickReplies: z
    .array(z.object({ title: z.string().trim().min(1).max(40), text: z.string().trim().min(1).max(2000) }))
    .max(50),
});

settingsRouter.patch("/quick-replies", async (req, res) => {
  const parsed = quickRepliesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const quickReplies = JSON.stringify(parsed.data.quickReplies);
  const settings = await prisma.settings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", aiSystemPrompt: "", businessInfo: "", quickReplies },
    update: { quickReplies },
  });
  getIO().emit("settings:updated", settings);
  res.json(parsed.data.quickReplies);
});

settingsRouter.put("/", requireAdmin, async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const settings = await prisma.settings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...parsed.data },
    update: parsed.data,
  });
  res.json(settings);
});
