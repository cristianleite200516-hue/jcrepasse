import { prisma } from "./prisma";
import { getIO } from "./events";

// Não existe tabela de campanhas: cada disparo grava a mesma mensagem (sender AGENT, mesmo texto) na
// conversa de cada lead. Uma "campanha" aqui é esse texto repetido em vários leads num período.
const RECENT_DAYS = 30;
const MIN_RECIPIENTS = 3; // menos que isso é mensagem manual repetida ("ok", "bom dia"), não campanha

export interface RecentCampaign {
  content: string;
  sentCount: number;
  firstAt: Date;
  lastAt: Date;
}

export async function listRecentCampaigns(): Promise<RecentCampaign[]> {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const groups = await prisma.message.groupBy({
    by: ["content"],
    where: { sender: "AGENT", createdAt: { gte: since }, attachmentId: null },
    _count: { _all: true },
    _min: { createdAt: true },
    _max: { createdAt: true },
  });
  return groups
    .filter((g) => g._count._all >= MIN_RECIPIENTS)
    .map((g) => ({
      content: g.content,
      sentCount: g._count._all,
      firstAt: g._min.createdAt!,
      lastAt: g._max.createdAt!,
    }))
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
    .slice(0, 15);
}

export interface CampaignResponder {
  leadId: string;
  name: string | null;
  phone: string;
  status: string;
  vehicleInfo: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  repliedAt: Date;
  firstReply: string;
}

// Quem recebeu o texto da campanha e mandou alguma mensagem depois dele (a primeira resposta conta).
export async function getCampaignResponses(content: string) {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const sentMessages = await prisma.message.findMany({
    where: { sender: "AGENT", content, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { conversationId: true, createdAt: true },
  });

  // Mesmo lead recebendo o texto mais de uma vez: conta a partir do primeiro envio.
  const sentAtByConversation = new Map<string, Date>();
  for (const m of sentMessages) {
    if (!sentAtByConversation.has(m.conversationId)) sentAtByConversation.set(m.conversationId, m.createdAt);
  }

  const responders: CampaignResponder[] = [];
  for (const [conversationId, sentAt] of sentAtByConversation) {
    const reply = await prisma.message.findFirst({
      where: { conversationId, sender: "LEAD", createdAt: { gt: sentAt } },
      orderBy: { createdAt: "asc" },
      select: {
        content: true,
        createdAt: true,
        conversation: {
          select: {
            lead: {
              select: {
                id: true,
                name: true,
                phone: true,
                status: true,
                vehicleInfo: true,
                vehicleBrand: true,
                vehicleModel: true,
                vehicleYear: true,
              },
            },
          },
        },
      },
    });
    if (!reply) continue;
    const lead = reply.conversation.lead;
    responders.push({
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone,
      status: lead.status,
      vehicleInfo: lead.vehicleInfo,
      vehicleBrand: lead.vehicleBrand,
      vehicleModel: lead.vehicleModel,
      vehicleYear: lead.vehicleYear,
      repliedAt: reply.createdAt,
      firstReply: reply.content.slice(0, 200),
    });
  }
  responders.sort((a, b) => b.repliedAt.getTime() - a.repliedAt.getTime());

  return { sentCount: sentAtByConversation.size, responders };
}

// Etapas que já passaram de Qualificado — mover quem respondeu nunca rebaixa esses leads.
const PROTECTED_STATUSES = new Set(["PROPOSTA", "GANHO", "FECHADO"]);

export async function moveCampaignResponders(content: string, toStatus: string) {
  const { responders } = await getCampaignResponses(content);
  const toMove = responders.filter((r) => r.status !== toStatus && !PROTECTED_STATUSES.has(r.status));

  for (const r of toMove) {
    const updated = await prisma.lead.update({
      where: { id: r.leadId },
      // Lead que estava Perdido e respondeu volta pro funil — o motivo da perda não vale mais.
      data: { status: toStatus, ...(r.status === "PERDIDO" ? { lossReason: null } : {}) },
    });
    getIO().emit("lead:updated", updated);
  }

  return {
    moved: toMove.length,
    alreadyInStatus: responders.filter((r) => r.status === toStatus).length,
    skippedAdvanced: responders.filter((r) => PROTECTED_STATUSES.has(r.status)).length,
  };
}
