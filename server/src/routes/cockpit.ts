import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { getIO } from "../lib/events";
import { getAgenda, getFollowUps, getArchivableStalled, getLostLeads, getNeedsMe, getSoldCandidates, getStalledLeads, getToDecide } from "../lib/cockpit";
import { getWhatsAppStatus, sendWhatsAppMessage } from "../whatsapp/client";
import { generateAiReply } from "../ai/attendant";

export const cockpitRouter = Router();
cockpitRouter.use(requireAuth);

// Painel do dia (página Rotina): os 4 blocos de uma vez.
cockpitRouter.get("/", async (_req, res) => {
  const [needsMe, toDecide, agenda, followUps] = await Promise.all([
    getNeedsMe(),
    getToDecide(),
    getAgenda(),
    getFollowUps(),
  ]);
  res.json({ whatsappStatus: getWhatsAppStatus(), needsMe, toDecide, agenda, followUps });
});

// Página Parados: leads em aberto sem conversa há N dias (padrão 3).
cockpitRouter.get("/stalled", async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 3));
  res.json(await getStalledLeads(days));
});

// Leads que disseram que já venderam o veículo — a página Parados oferece excluir (pelo DELETE /leads/:id).
cockpitRouter.get("/sold-candidates", requireAdmin, async (_req, res) => {
  res.json(await getSoldCandidates());
});

// Página Limpeza (admin): resumo do funil e ações em lote. Nada aqui apaga lead — a exclusão definitiva
// é feita pela pessoa, na tela, pelo DELETE /leads/:id.
cockpitRouter.get("/cleanup/summary", requireAdmin, async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const [byStatus, lost, sold, archivable] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], where: { phone: { not: "status@broadcast" } }, _count: true }),
    getLostLeads(),
    getSoldCandidates(),
    getArchivableStalled(days),
  ]);
  res.json({
    days,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
    lostCount: lost.count,
    soldCount: sold.count,
    archivable: {
      count: archivable.length,
      items: archivable.map((it) => ({ lead: it.lead, daysStalled: it.daysStalled, lastMessage: it.lastMessage })),
    },
  });
});

cockpitRouter.get("/cleanup/lost", requireAdmin, async (_req, res) => {
  res.json(await getLostLeads());
});

// Reversível: só troca o status pra Perdido (com motivo) e desliga a IA na conversa. Dá pra mover de volta.
cockpitRouter.post("/cleanup/archive-stalled", requireAdmin, async (req, res) => {
  const parsed = z.object({ days: z.number().int().min(7).max(365) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const items = await getArchivableStalled(parsed.data.days);
  let moved = 0;
  for (const it of items) {
    const updated = await prisma.lead.update({
      where: { id: it.lead.id },
      data: { status: "PERDIDO", lossReason: `Parado há ${parsed.data.days}+ dias sem resposta (limpeza do funil)` },
    });
    getIO().emit("lead:updated", updated);
    const conv = await prisma.conversation.findUnique({ where: { leadId: it.lead.id } });
    if (conv) {
      await prisma.conversation.update({ where: { id: conv.id }, data: { aiEnabled: false, aiPausedUntil: null } });
      getIO().emit("conversation:updated", { id: conv.id, leadId: it.lead.id, aiEnabled: false, aiPausedUntil: null });
    }
    moved++;
  }
  res.json({ moved });
});

const INTEREST_INSTRUCTION =
  "[Nota interna do sistema — não é mensagem do lead] A equipe analisou as fotos e os dados do veículo e TEM " +
  "interesse. Avise o lead de forma breve e animada que a loja gostou do carro e puxe AGORA o agendamento da " +
  "avaliação presencial (na loja ou no endereço dele), propondo dia e horário concretos dentro do horário de " +
  "atendimento. Continua valendo: não fale nenhum valor.";

// Decisão do dono sobre um lead qualificado com fotos.
// - Tem interesse: vai pra Proposta e a IA (religada, se estava desligada/pausada) manda na hora a
//   mensagem puxando a avaliação presencial.
// - Sem interesse: vai pra Perdido com o motivo e a IA é desligada nessa conversa (senão, se o lead
//   escrevesse de novo, ela reabriria o lead e ele voltaria pra fila de decisão).
cockpitRouter.post("/decide/:leadId", async (req, res) => {
  const parsed = z.object({ interest: z.boolean(), reason: z.string().max(200).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const lead = await prisma.lead.findUnique({ where: { id: req.params.leadId }, include: { conversation: true } });
  if (!lead) return res.status(404).json({ error: "Lead não encontrado" });

  if (!parsed.data.interest) {
    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "PERDIDO", lossReason: parsed.data.reason?.trim() || "Sem interesse após análise das fotos" },
    });
    getIO().emit("lead:updated", updated);
    if (lead.conversation) {
      await prisma.conversation.update({ where: { id: lead.conversation.id }, data: { aiEnabled: false, aiPausedUntil: null } });
      getIO().emit("conversation:updated", { id: lead.conversation.id, leadId: lead.id, aiEnabled: false, aiPausedUntil: null });
    }
    return res.json({ ok: true });
  }

  const updated = await prisma.lead.update({ where: { id: lead.id }, data: { status: "PROPOSTA" } });
  getIO().emit("lead:updated", updated);
  if (lead.conversation) {
    await prisma.conversation.update({ where: { id: lead.conversation.id }, data: { aiEnabled: true, aiPausedUntil: null } });
    getIO().emit("conversation:updated", { id: lead.conversation.id, leadId: lead.id, aiEnabled: true, aiPausedUntil: null });
  }

  if (getWhatsAppStatus() !== "READY") {
    return res.json({ ok: true, warning: "Lead movido pra Proposta, mas o WhatsApp não está conectado — a mensagem pro lead não foi enviada." });
  }
  try {
    const reply = await generateAiReply(lead.id, undefined, false, INTEREST_INSTRUCTION);
    if (reply) await sendWhatsAppMessage(lead.phone, reply);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao mandar a mensagem de interesse pro lead:", err);
    return res.json({ ok: true, warning: "Lead movido pra Proposta, mas a mensagem da IA não pôde ser enviada." });
  }
});
