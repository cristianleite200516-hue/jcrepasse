import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { markContactedIfNew } from "../lib/leadStatus";
import { toOggOpus } from "../lib/audioConvert";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { getIO } from "../lib/events";
import { fillTemplate, randomDelayMs, recordBroadcastSent, remainingToday } from "../lib/sendPolicy";
import { summarizeConversation } from "../ai/attendant";
import {
  sendWhatsAppMessage,
  sendWhatsAppLocation,
  sendWhatsAppAudio,
  resolveRealPhoneNumber,
  deleteWhatsAppMessage,
} from "../whatsapp/client";

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

// Fica dentro de .wwebjs_auth (montado no volume persistente do Railway) de propósito: uma
// pasta "uploads" separada, fora do volume, é recriada vazia a cada deploy — as fotos e
// documentos que os leads mandam somem sozinhos sem nenhum aviso.
//
// ATENÇÃO — NUNCA rode "rm -rf .wwebjs_auth" inteiro pra forçar um logout/reset do WhatsApp:
// isso apaga os uploads de negócio junto (aconteceu de verdade em 23/09/2026, 778 anexos
// perdidos sem backup, sem Time Machine nem Dropbox cobrindo essa pasta). Pra resetar só a
// sessão do WhatsApp, apague APENAS ".wwebjs_auth/session" (e ".wwebjs_cache" na raiz do
// projeto, se precisar) — nunca ".wwebjs_auth" inteira.
const UPLOADS_DIR = path.join(__dirname, "..", "..", ".wwebjs_auth", "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype.startsWith("audio/"));
  },
});

conversationsRouter.get("/", async (_req, res) => {
  const conversations = await prisma.conversation.findMany({
    include: {
      lead: {
        select: {
          id: true,
          name: true,
          phone: true,
          phone2: true,
          areaCode: true,
          status: true,
          vehicleBrand: true,
          vehicleModel: true,
          vehicleYear: true,
          vehicleInfo: true,
        },
      },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const summaries = conversations
    .map((c) => ({
      id: c.id,
      leadId: c.leadId,
      aiEnabled: c.aiEnabled,
      aiPausedUntil: c.aiPausedUntil,
      unread: c.unread,
      lead: c.lead,
      lastMessage: c.messages[0] ?? null,
    }))
    .sort((a, b) => {
      const at = a.lastMessage?.createdAt ?? new Date(0);
      const bt = b.lastMessage?.createdAt ?? new Date(0);
      return new Date(bt).getTime() - new Date(at).getTime();
    });

  res.json(summaries);
});

// Contatos migrados pro LID do WhatsApp aparecem só com um ID interno, sem telefone real —
// impossível de localizar pesquisando no app do WhatsApp. Isso tenta resolver o número de
// verdade por trás do LID (nem sempre disponível, depende de configuração de privacidade do
// contato).
conversationsRouter.get("/:leadId/whatsapp-number", async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.leadId }, select: { phone: true } });
  if (!lead) return res.status(404).json({ error: "Lead não encontrado" });

  if (!lead.phone.endsWith("@lid")) {
    return res.json({ number: lead.phone });
  }

  const number = await resolveRealPhoneNumber(lead.phone);
  res.json({ number });
});

conversationsRouter.post("/:leadId/summary", async (req, res) => {
  try {
    res.json({ summary: await summarizeConversation(req.params.leadId) });
  } catch (err) {
    console.error("Erro ao resumir a conversa:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Falha ao resumir a conversa" });
  }
});

conversationsRouter.patch("/:leadId/ai-toggle", async (req, res) => {
  const schema = z.object({ aiEnabled: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const conversation = await prisma.conversation.update({
    where: { leadId: req.params.leadId },
    data: { aiEnabled: parsed.data.aiEnabled, aiPausedUntil: null },
  });

  getIO().emit("conversation:updated", conversation);
  res.json(conversation);
});

// Chamado quando alguém abre a conversa no painel — tira o destaque de "não lida".
conversationsRouter.patch("/:leadId/read", async (req, res) => {
  const conversation = await prisma.conversation.update({
    where: { leadId: req.params.leadId },
    data: { unread: false },
  });

  getIO().emit("conversation:updated", { id: conversation.id, leadId: req.params.leadId, unread: false });
  res.json(conversation);
});

// Mesmo texto pra uma lista de leads (ex: todos da fila "Precisa de mim"). Roda em segundo plano —
// com o intervalo entre envios, uma lista grande passaria do tempo limite de uma requisição — e avisa
// o painel pelo socket quando termina. Um envio em massa por vez; para depois de 5 falhas seguidas
// (WhatsApp caiu), igual às campanhas. Não pausa a IA: as respostas dos leads seguem o fluxo normal.
const BULK_MAX_CONSECUTIVE_FAILURES = 5;
let bulkRunning = false;

conversationsRouter.post("/bulk-message", requireAdmin, async (req, res) => {
  const parsed = z
    .object({ leadIds: z.array(z.string().min(1)).min(1).max(300), content: z.string().trim().min(1).max(2000) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (bulkRunning) return res.status(409).json({ error: "Já tem um envio em massa em andamento, aguarde terminar." });

  // Quem pediu pra sair (SAIR) fica de fora.
  const leads = await prisma.lead.findMany({
    where: { id: { in: parsed.data.leadIds }, doNotContact: false },
    include: { conversation: true },
  });
  bulkRunning = true;
  res.status(202).json({ queued: leads.length });

  const content = parsed.data.content;
  let sent = 0;
  let failed = 0;
  let consecutiveFailures = 0;
  let stoppedEarly = false;
  let quotaReached = false;
  try {
    for (const lead of leads) {
      if ((await remainingToday()) <= 0) {
        quotaReached = true;
        break;
      }
      try {
        const text = fillTemplate(content, lead);
        await sendWhatsAppMessage(lead.phone, text);
        await recordBroadcastSent();
        const conversation = lead.conversation ?? (await prisma.conversation.create({ data: { leadId: lead.id } }));
        const message = await prisma.message.create({
          data: { conversationId: conversation.id, sender: "AGENT", content: text },
        });
        getIO().emit("message:new", { leadId: lead.id, message });
        await markContactedIfNew(lead.id);
        sent++;
        consecutiveFailures = 0;
      } catch (err) {
        console.error(`Envio em massa: falha pro lead ${lead.id}:`, err instanceof Error ? err.message : err);
        failed++;
        if (++consecutiveFailures >= BULK_MAX_CONSECUTIVE_FAILURES) {
          stoppedEarly = true;
          break;
        }
      }
      getIO().emit("bulk-message:progress", { done: sent + failed, total: leads.length });
      await new Promise((r) => setTimeout(r, randomDelayMs()));
    }
  } finally {
    bulkRunning = false;
    console.log(`Envio em massa: ${sent} enviada(s), ${failed} falha(s)${stoppedEarly ? " — interrompido" : ""}`);
    getIO().emit("bulk-message:done", { sent, failed, total: leads.length, stoppedEarly, quotaReached });
  }
});

// Quanto tempo a IA espera depois de uma resposta da equipe antes de voltar a atender a conversa.
const HUMAN_REPLY_AI_PAUSE_MS = 2 * 60 * 60 * 1000;

// Alguém da equipe respondeu: a IA não responde por cima enquanto a pessoa está na conversa, mas
// volta sozinha depois da pausa (antes ficava desligada pra sempre e cada conversa tocada virava
// trabalho manual permanente). Conversa com a IA desligada de vez continua desligada.
async function pauseAiForHumanReply(conversation: { id: string; leadId: string; aiEnabled: boolean }) {
  if (!conversation.aiEnabled) return;
  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { aiPausedUntil: new Date(Date.now() + HUMAN_REPLY_AI_PAUSE_MS) },
  });
  getIO().emit("conversation:updated", {
    id: updated.id,
    leadId: conversation.leadId,
    aiEnabled: updated.aiEnabled,
    aiPausedUntil: updated.aiPausedUntil,
  });
}

conversationsRouter.post("/:leadId/messages", async (req, res) => {
  // returnToAi: "enviar e devolver pra IA" — a equipe respondeu algo pontual e a IA segue a conversa já.
  const schema = z.object({ content: z.string().min(1), returnToAi: z.boolean().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const lead = await prisma.lead.findUnique({
    where: { id: req.params.leadId },
    include: { conversation: true },
  });
  if (!lead?.conversation) return res.status(404).json({ error: "Lead ou conversa não encontrada" });

  try {
    await sendWhatsAppMessage(lead.phone, parsed.data.content);
  } catch (err) {
    console.error("Erro ao enviar mensagem manual via WhatsApp:", err);
    // Devolve o motivo real: "não está conectado" fixo escondia falhas de envio com o WhatsApp
    // conectado (timeout, número inválido, erro da página), e o painel mostrava "Conectado" sem
    // explicação nenhuma.
    return res.status(503).json({ error: err instanceof Error ? err.message : "Falha ao enviar pelo WhatsApp" });
  }

  const message = await prisma.message.create({
    data: { conversationId: lead.conversation.id, sender: "AGENT", content: parsed.data.content },
  });

  getIO().emit("message:new", { leadId: lead.id, message });
  await markContactedIfNew(lead.id);

  if (parsed.data.returnToAi) {
    const updated = await prisma.conversation.update({
      where: { id: lead.conversation.id },
      data: { aiEnabled: true, aiPausedUntil: null },
    });
    getIO().emit("conversation:updated", {
      id: updated.id,
      leadId: lead.id,
      aiEnabled: updated.aiEnabled,
      aiPausedUntil: updated.aiPausedUntil,
    });
  } else {
    await pauseAiForHumanReply(lead.conversation);
  }

  res.status(201).json(message);
});

// Apaga a mensagem no WhatsApp de verdade ("apagar para todos") e marca como apagada aqui no
// CRM. Só vale pra mensagens que a própria loja mandou (agente ou IA) — não dá pra revogar uma
// mensagem que o lead mandou, e o WhatsApp tem uma janela de tempo curta pra permitir isso.
conversationsRouter.delete("/messages/:messageId", async (req, res) => {
  const message = await prisma.message.findUnique({ where: { id: req.params.messageId } });
  if (!message) return res.status(404).json({ error: "Mensagem não encontrada" });
  if (message.sender === "LEAD") {
    return res.status(400).json({ error: "Não é possível apagar uma mensagem enviada pelo lead" });
  }
  if (!message.waMessageId) {
    return res.status(400).json({ error: "Essa mensagem não tem correspondente no WhatsApp" });
  }

  try {
    await deleteWhatsAppMessage(message.waMessageId);
  } catch (err) {
    console.error("Erro ao apagar mensagem no WhatsApp:", err);
    return res.status(503).json({
      error: err instanceof Error ? err.message : "Não foi possível apagar a mensagem no WhatsApp",
    });
  }

  const updated = await prisma.message.update({
    where: { id: message.id },
    data: { content: "🚫 Mensagem apagada" },
    include: { conversation: { select: { leadId: true } } },
  });

  getIO().emit("message:deleted", { leadId: updated.conversation.leadId, message: updated });
  res.json(updated);
});

conversationsRouter.post("/:leadId/location", async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.leadId },
    include: { conversation: true },
  });
  if (!lead?.conversation) return res.status(404).json({ error: "Lead ou conversa não encontrada" });

  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  if (settings?.storeLat == null || settings?.storeLng == null) {
    return res.status(400).json({ error: "Localização da loja não configurada (veja Configurações)" });
  }

  try {
    await sendWhatsAppLocation(
      lead.phone,
      settings.storeLat,
      settings.storeLng,
      settings.storeName ?? undefined,
      settings.storeAddress ?? undefined
    );
  } catch (err) {
    console.error("Erro ao enviar localização via WhatsApp:", err);
    return res.status(503).json({ error: "WhatsApp não está conectado" });
  }

  const content = `📍 Localização enviada${settings.storeName ? `: ${settings.storeName}` : ""}`;
  const message = await prisma.message.create({
    data: { conversationId: lead.conversation.id, sender: "AGENT", content },
  });

  getIO().emit("message:new", { leadId: lead.id, message });
  await markContactedIfNew(lead.id);
  await pauseAiForHumanReply(lead.conversation);
  res.status(201).json(message);
});

conversationsRouter.post("/:leadId/audio", audioUpload.single("audio"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Nenhum áudio enviado" });

  const lead = await prisma.lead.findUnique({
    where: { id: req.params.leadId },
    include: { conversation: true },
  });
  if (!lead?.conversation) return res.status(404).json({ error: "Lead ou conversa não encontrada" });

  const audio = await toOggOpus(file.buffer, file.mimetype);

  try {
    await sendWhatsAppAudio(lead.phone, audio.buffer, audio.mimetype);
  } catch (err) {
    console.error("Erro ao enviar áudio via WhatsApp:", err);
    return res.status(503).json({ error: err instanceof Error ? err.message : "Falha ao enviar pelo WhatsApp" });
  }

  const ext = audio.mimetype.split("/")[1]?.split(";")[0] || "ogg";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), audio.buffer);

  const attachment = await prisma.attachment.create({
    data: {
      leadId: lead.id,
      filename,
      originalName: file.originalname || filename,
      mimeType: audio.mimetype,
      size: audio.buffer.length,
      category: "AUDIO",
    },
  });

  const message = await prisma.message.create({
    data: {
      conversationId: lead.conversation.id,
      sender: "AGENT",
      content: "🎤 Áudio enviado",
      attachmentId: attachment.id,
    },
  });

  getIO().emit("message:new", { leadId: lead.id, message: { ...message, attachment } });
  getIO().emit("attachments:updated", { leadId: lead.id });
  await markContactedIfNew(lead.id);
  await pauseAiForHumanReply(lead.conversation);
  res.status(201).json({ ...message, attachment });
});
