import { prisma } from "./prisma";
import { getIO } from "./events";

// Antes da pausa de 2h existir, toda resposta manual desligava a IA da conversa pra sempre. Isso
// religa essas conversas de uma vez, deixando de fora as que a própria IA passou pra equipe.
//
// O CRM não registra o motivo do desligamento, então a passagem pra humano é reconhecida pelo
// assunto: a IA só faz handoff quando o assunto é endereço/localização da loja. Se a última
// mensagem da IA (ou a do lead logo antes dela) fala disso, a conversa fica de fora. É conservador
// de propósito — também pula avaliações no endereço do lead; melhor sobrar desligada (religa no
// botão da conversa) do que a IA voltar numa conversa que a equipe assumiu.
const HANDOFF_PATTERN = /endere[cç]o|localiza[cç][aã]o|onde fica|onde voc[eê]s|como chego|google maps|📍/i;
const ADVANCED_STATUSES = ["PROPOSTA", "GANHO", "FECHADO"];

export interface AiReenableItem {
  leadId: string;
  name: string | null;
  phone: string;
  status: string;
  vehicleInfo: string | null;
}

async function classifyDisabledConversations() {
  const conversations = await prisma.conversation.findMany({
    where: { aiEnabled: false, lead: { status: { notIn: ADVANCED_STATUSES } } },
    include: {
      lead: { select: { id: true, name: true, phone: true, status: true, vehicleInfo: true } },
      messages: { where: { sender: { in: ["AI", "LEAD"] } }, orderBy: { createdAt: "desc" }, take: 40 },
    },
  });

  const toReenable: (AiReenableItem & { conversationId: string })[] = [];
  const handedOff: AiReenableItem[] = [];

  for (const conversation of conversations) {
    const lastAiIndex = conversation.messages.findIndex((m) => m.sender === "AI");
    const lastAi = lastAiIndex >= 0 ? conversation.messages[lastAiIndex] : null;
    const leadBeforeLastAi = lastAi
      ? conversation.messages.slice(lastAiIndex + 1).find((m) => m.sender === "LEAD")
      : null;
    const isHandoff =
      !!lastAi && (HANDOFF_PATTERN.test(lastAi.content) || (!!leadBeforeLastAi && HANDOFF_PATTERN.test(leadBeforeLastAi.content)));

    const item: AiReenableItem = {
      leadId: conversation.lead.id,
      name: conversation.lead.name,
      phone: conversation.lead.phone,
      status: conversation.lead.status,
      vehicleInfo: conversation.lead.vehicleInfo,
    };
    if (isHandoff) handedOff.push(item);
    else toReenable.push({ ...item, conversationId: conversation.id });
  }

  return { toReenable, handedOff };
}

export async function previewAiReenable() {
  const { toReenable, handedOff } = await classifyDisabledConversations();
  return { toReenable: toReenable.map(({ conversationId: _c, ...rest }) => rest), handedOff };
}

export async function applyAiReenable() {
  const { toReenable, handedOff } = await classifyDisabledConversations();
  for (const item of toReenable) {
    const updated = await prisma.conversation.update({
      where: { id: item.conversationId },
      data: { aiEnabled: true, aiPausedUntil: null },
    });
    getIO().emit("conversation:updated", {
      id: updated.id,
      leadId: item.leadId,
      aiEnabled: true,
      aiPausedUntil: null,
    });
  }
  return { reenabled: toReenable.length, keptHandedOff: handedOff.length };
}
