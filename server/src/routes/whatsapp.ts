import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../middleware/auth";
import {
  initWhatsApp,
  getWhatsAppStatus,
  getWhatsAppQr,
  importExistingChats,
  catchUpUnanswered,
  previewStalledLeads,
  reengageStalledLeads,
  broadcastFixedMessage,
  countCampaignAudience,
} from "../whatsapp/client";
import { getCampaignResponses, listRecentCampaigns, moveCampaignResponders } from "../lib/campaignResults";
import { applyAiReenable, previewAiReenable } from "../lib/aiReenable";
import { getIO } from "../lib/events";
import { remainingToday, SEND_POLICY } from "../lib/sendPolicy";

export const whatsappRouter = Router();
whatsappRouter.use(requireAuth);

whatsappRouter.get("/status", (_req, res) => {
  const status = getWhatsAppStatus();
  res.json({ status, qr: status === "QR" ? getWhatsAppQr() : null });
});

whatsappRouter.post("/connect", (_req, res) => {
  initWhatsApp();
  res.json({ status: getWhatsAppStatus() });
});

whatsappRouter.post("/import", async (req, res) => {
  const sinceDays = Number(req.body?.sinceDays) || 3;
  try {
    const summary = await importExistingChats(100, sinceDays);
    res.json(summary);
  } catch (err) {
    console.error("Erro ao importar conversas do WhatsApp:", err);
    res.status(503).json({ error: err instanceof Error ? err.message : "Falha ao importar" });
  }
});

whatsappRouter.post("/catch-up", requireAdmin, async (_req, res) => {
  try {
    const summary = await catchUpUnanswered();
    res.json(summary);
  } catch (err) {
    console.error("Erro ao responder leads atrasados:", err);
    res.status(503).json({ error: err instanceof Error ? err.message : "Falha ao responder leads" });
  }
});

const daysSchema = z.object({ days: z.number().min(0.01).max(90).optional() });

whatsappRouter.get("/stalled-leads", requireAdmin, async (req, res) => {
  const parsed = daysSchema.safeParse({ days: req.query.days ? Number(req.query.days) : undefined });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const preview = await previewStalledLeads(parsed.data.days ?? 3);
    res.json(preview);
  } catch (err) {
    console.error("Erro ao listar leads parados:", err);
    res.status(500).json({ error: "Falha ao listar leads parados" });
  }
});

// Em segundo plano (intervalo de 25-75 s entre mensagens): o resultado chega pelo socket (reengage:done).
let reengageRunning = false;

whatsappRouter.post("/reengage-stalled", requireAdmin, async (req, res) => {
  const parsed = daysSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (reengageRunning) return res.status(409).json({ error: "Já tem um reengajamento em andamento, aguarde terminar." });
  if (getWhatsAppStatus() !== "READY") return res.status(503).json({ error: "WhatsApp não está conectado" });
  const remaining = await remainingToday();
  if (remaining <= 0) {
    return res.status(429).json({ error: `Limite diário de ${SEND_POLICY.dailyLimit} envios em lote atingido. Continue amanhã.` });
  }
  reengageRunning = true;
  res.status(202).json({ queued: true, remainingToday: remaining });

  try {
    const summary = await reengageStalledLeads(parsed.data.days ?? 3);
    getIO().emit("reengage:done", summary);
  } catch (err) {
    console.error("Erro ao reengajar leads parados:", err);
    getIO().emit("reengage:done", { attempted: 0, sent: 0, failed: 0, error: err instanceof Error ? err.message : "Falha ao reengajar leads" });
  } finally {
    reengageRunning = false;
  }
});

const STATUS_ENUM = z.enum(["NOVO", "CONTATADO", "QUALIFICADO", "PROPOSTA", "GANHO", "FECHADO", "PERDIDO"]);

const campaignFiltersSchema = z.object({
  status: STATUS_ENUM.optional(),
  vehicleBrand: z.string().min(1).optional(),
  minScore: z.number().min(0).max(100).optional(),
  maxScore: z.number().min(0).max(100).optional(),
  awaitingEngagementHours: z.number().min(1).max(720).optional(),
});

whatsappRouter.post("/broadcast-preview", requireAdmin, async (req, res) => {
  const parsed = campaignFiltersSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const count = await countCampaignAudience(parsed.data);
  res.json({ count });
});

const broadcastSchema = z.object({
  filters: campaignFiltersSchema,
  toStatus: STATUS_ENUM.optional(),
  message: z.string().min(1),
});

// Limites e ritmo dos disparos (mostrados na tela de Campanhas).
whatsappRouter.get("/broadcast-limits", requireAdmin, async (_req, res) => {
  res.json({
    dailyLimit: SEND_POLICY.dailyLimit,
    remainingToday: await remainingToday(),
    minDelayS: SEND_POLICY.minDelayS,
    maxDelayS: SEND_POLICY.maxDelayS,
  });
});

// O disparo roda em segundo plano: com intervalo de 25-75 s entre mensagens, uma campanha de dezenas de
// leads leva dezenas de minutos e estouraria o tempo limite da requisição. O progresso e o resultado
// chegam pelo socket (broadcast:progress / broadcast:done). Um disparo por vez.
let broadcastRunning = false;

whatsappRouter.post("/broadcast", requireAdmin, async (req, res) => {
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (broadcastRunning) return res.status(409).json({ error: "Já tem um disparo em andamento, aguarde terminar." });
  if (getWhatsAppStatus() !== "READY") return res.status(503).json({ error: "WhatsApp não está conectado" });

  const remaining = await remainingToday();
  if (remaining <= 0) {
    return res.status(429).json({ error: `Limite diário de ${SEND_POLICY.dailyLimit} envios em lote atingido. Continue amanhã.` });
  }
  const audience = await countCampaignAudience(parsed.data.filters);
  broadcastRunning = true;
  res.status(202).json({ queued: Math.min(audience, remaining), audience, remainingToday: remaining });

  try {
    const summary = await broadcastFixedMessage(
      parsed.data.filters,
      parsed.data.message,
      parsed.data.toStatus,
      undefined,
      (done, total) => getIO().emit("broadcast:progress", { done, total })
    );
    getIO().emit("broadcast:done", summary);
  } catch (err) {
    console.error("Erro ao disparar mensagem em massa:", err);
    getIO().emit("broadcast:done", { attempted: 0, sent: 0, failed: 0, error: err instanceof Error ? err.message : "Falha ao disparar mensagem" });
  } finally {
    broadcastRunning = false;
  }
});

whatsappRouter.get("/campaigns/recent", requireAdmin, async (_req, res) => {
  res.json(await listRecentCampaigns());
});

const campaignContentSchema = z.object({ content: z.string().min(1) });

whatsappRouter.post("/campaigns/responses", requireAdmin, async (req, res) => {
  const parsed = campaignContentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await getCampaignResponses(parsed.data.content));
});

whatsappRouter.post("/campaigns/move-responders", requireAdmin, async (req, res) => {
  const parsed = campaignContentSchema.extend({ toStatus: STATUS_ENUM }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await moveCampaignResponders(parsed.data.content, parsed.data.toStatus));
});

whatsappRouter.get("/ai-reenable/preview", requireAdmin, async (_req, res) => {
  res.json(await previewAiReenable());
});

whatsappRouter.post("/ai-reenable", requireAdmin, async (_req, res) => {
  res.json(await applyAiReenable());
});
