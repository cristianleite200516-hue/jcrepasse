import { prisma } from "./prisma";
import { getIO } from "./events";

// Lead que já recebeu resposta (da IA ou da equipe) não é mais "Novo" — sem isso quase todo lead
// ficava parado em NOVO pra sempre e o funil não dizia nada sobre quem já foi atendido.
export async function markContactedIfNew(leadId: string) {
  const { count } = await prisma.lead.updateMany({
    where: { id: leadId, status: "NOVO" },
    data: { status: "CONTATADO" },
  });
  if (count === 0) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (lead) getIO().emit("lead:updated", lead);
}

// Etapas que a IA pode definir sozinha. PROPOSTA e GANHO/FECHADO dependem da equipe (a IA nunca
// fala valor nem fecha negócio), então ficam de fora.
const AI_STATUS_RANK: Record<string, number> = { NOVO: 0, CONTATADO: 1, QUALIFICADO: 2, PROPOSTA: 3 };

// Filtra o status que a IA pediu: só avança no funil (nunca rebaixa um lead que a equipe já moveu
// pra Proposta, por exemplo) e nunca mexe em lead já fechado. Um lead PERDIDO que voltou a
// conversar pode ser reaberto.
export function sanitizeAiStatus(current: string, proposed: unknown): string | undefined {
  if (typeof proposed !== "string") return undefined;
  if (current === "GANHO" || current === "FECHADO") return undefined;
  if (proposed === "PERDIDO") return current === "PERDIDO" ? undefined : "PERDIDO";
  if (proposed !== "CONTATADO" && proposed !== "QUALIFICADO") return undefined;
  const currentRank = current === "PERDIDO" ? 0 : AI_STATUS_RANK[current] ?? 0;
  return AI_STATUS_RANK[proposed] > currentRank ? proposed : undefined;
}

// Acerto dos leads de antes da regra acima existir: quem está em NOVO mas já recebeu alguma resposta
// (da IA ou da equipe) passa pra CONTATADO. Roda a cada boot, mas depois da primeira vez não acha
// mais nada — lead nunca respondido continua em NOVO.
export async function backfillContactedLeads() {
  const { count } = await prisma.lead.updateMany({
    where: {
      status: "NOVO",
      conversation: { messages: { some: { sender: { in: ["AI", "AGENT"] } } } },
    },
    data: { status: "CONTATADO" },
  });
  if (count > 0) console.log(`Funil: ${count} lead(s) já respondidos saíram de Novo para Contatado`);
}
