import { prisma } from "./prisma";
import { getIO } from "./events";
import { addDays, dayKey, getAgenda, getNeedsMe, getToDecide, leadTitle, startOfDay } from "./cockpit";
import { getWhatsAppStatus, reengageStalledLeads, sendWhatsAppMessage } from "../whatsapp/client";
import { isAiPaused } from "../ai/attendant";

// Rotinas automáticas do painel do dia. Uma checagem a cada 5 min decide o que está na hora de rodar;
// as datas de execução ficam no banco (Settings / Appointment.confirmationSentAt), então um reinício
// do servidor não repete nada no mesmo dia. Horários em Brasília (ENV TZ no Dockerfile).

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DAILY_SUMMARY_HOUR = 8; // resumo das visitas e pendências do dia, pro WhatsApp do dono
const CONFIRMATION_HOURS = { from: 10, to: 20 }; // janela pra mandar a confirmação da visita de amanhã
const WEEKLY_FOLLOW_UP = { weekday: 1, hour: 10, until: 18 }; // segunda, das 10h às 18h
const STALLED_DAYS_TO_REENGAGE = 3;
const DAYS_TO_ARCHIVE_AFTER_REENGAGE = 7;

function fmtHour(date: Date) {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function visitPlace(notes: string | null) {
  if (notes?.startsWith("Visita na loja")) return "na loja";
  if (notes?.startsWith("Avaliação no endereço do lead")) return "no endereço do lead";
  return null;
}

async function getSettings() {
  return prisma.settings.findUnique({ where: { id: "singleton" } });
}

// 8h: resumo do dia no WhatsApp do dono (mesmo número do auditor).
async function runDailySummary(now: Date) {
  if (now.getHours() < DAILY_SUMMARY_HOUR) return;
  const settings = await getSettings();
  if (!settings?.auditPhone || settings.dailySummarySentOn === dayKey(now)) return;

  const [agenda, toDecide, needsMe] = await Promise.all([getAgenda(), getToDecide(), getNeedsMe()]);
  const visits = agenda.today.length
    ? agenda.today
        .map((a) => {
          const place = visitPlace(a.notes);
          return `• ${fmtHour(a.scheduledAt)} — ${leadTitle(a.lead)}${place ? ` (${place})` : ""}`;
        })
        .join("\n")
    : "• nenhuma visita hoje";
  const text =
    `☀️ Bom dia! Resumo de hoje:\n\n📅 Visitas:\n${visits}\n\n` +
    `🔥 Para decidir (qualificados com fotos): ${toDecide.count}\n` +
    `💬 Precisa de mim (leads esperando resposta): ${needsMe.count}\n\n` +
    `Tudo isso está na página Rotina do CRM.`;

  await sendWhatsAppMessage(settings.auditPhone, text);
  await prisma.settings.update({ where: { id: "singleton" }, data: { dailySummarySentOn: dayKey(now) } });
}

// Véspera da visita: confirma o dia/horário com o lead. A resposta dele cai na conversa normal
// (a IA vê a visita marcada e segue o atendimento).
async function runVisitConfirmations(now: Date) {
  const hour = now.getHours();
  if (hour < CONFIRMATION_HOURS.from || hour >= CONFIRMATION_HOURS.to) return;

  const tomorrow = addDays(startOfDay(now), 1);
  const appointments = await prisma.appointment.findMany({
    where: {
      scheduledAt: { gte: tomorrow, lt: addDays(tomorrow, 1) },
      status: "AGENDADO",
      confirmationSentAt: null,
    },
    include: { lead: { include: { conversation: true } } },
  });

  for (const a of appointments) {
    const firstName = a.lead.name?.trim().split(/\s+/)[0];
    const day = a.scheduledAt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
    const place = visitPlace(a.notes);
    const placeText = place === "na loja" ? " aqui na loja" : place === "no endereço do lead" ? " no seu endereço" : "";
    const text =
      `Oi${firstName ? `, ${firstName}` : ""}! Passando pra confirmar a avaliação do seu veículo amanhã ` +
      `(${day}) às ${fmtHour(a.scheduledAt)}${placeText}. Está confirmado? 🙂`;
    try {
      await sendWhatsAppMessage(a.lead.phone, text);
      if (a.lead.conversation) {
        const message = await prisma.message.create({
          data: { conversationId: a.lead.conversation.id, sender: "AI", content: text },
        });
        getIO().emit("message:new", { leadId: a.lead.id, message });
      }
      await prisma.appointment.update({ where: { id: a.id }, data: { confirmationSentAt: new Date() } });
    } catch (err) {
      console.error(`Falha ao mandar confirmação da visita ${a.id}:`, err);
    }
  }
}

// Segunda de manhã: arquiva quem já foi reengajado e ficou 7 dias sem responder, depois reengaja os
// parados (só leads em aberto) e manda o resumo pro dono.
async function runWeeklyFollowUp(now: Date) {
  if (now.getDay() !== WEEKLY_FOLLOW_UP.weekday) return;
  if (now.getHours() < WEEKLY_FOLLOW_UP.hour || now.getHours() >= WEEKLY_FOLLOW_UP.until) return;
  const settings = await getSettings();
  if (settings?.weeklyFollowUpRunOn === dayKey(now)) return;
  if (await isAiPaused()) return;

  // Marca antes de rodar: o reengajamento leva minutos (intervalo entre envios) e a próxima
  // checagem de 5 min não pode disparar uma segunda rodada em paralelo.
  await prisma.settings.update({ where: { id: "singleton" }, data: { weeklyFollowUpRunOn: dayKey(now) } });

  const archiveCutoff = new Date(now.getTime() - DAYS_TO_ARCHIVE_AFTER_REENGAGE * 24 * 60 * 60 * 1000);
  const candidates = await prisma.conversation.findMany({
    where: {
      followUpAttempts: { gte: 1 },
      lead: {
        status: { in: ["NOVO", "CONTATADO"] },
        appointments: { none: { scheduledAt: { gte: now }, status: { not: "CANCELADO" } } },
      },
    },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const toArchive = candidates.filter((c) => {
    const last = c.messages[0];
    return last && last.sender !== "LEAD" && last.createdAt < archiveCutoff;
  });
  for (const c of toArchive) {
    const updated = await prisma.lead.update({
      where: { id: c.leadId },
      data: { status: "PERDIDO", lossReason: "Parou de responder (7 dias sem resposta após reengajamento)" },
    });
    getIO().emit("lead:updated", updated);
  }

  const summary = await reengageStalledLeads(STALLED_DAYS_TO_REENGAGE, undefined, { onlyOpenLeads: true }).catch((err) => {
    console.error("Erro no reengajamento semanal:", err);
    return null;
  });

  console.log(
    `Follow-up semanal: ${toArchive.length} arquivado(s), ${summary ? `${summary.sent} reengajado(s)` : "reengajamento falhou"}`
  );
  if (settings?.auditPhone) {
    await sendWhatsAppMessage(
      settings.auditPhone,
      `🔁 Follow-up semanal feito:\n• ${summary?.sent ?? 0} lead(s) parado(s) receberam mensagem de reengajamento\n` +
        `• ${toArchive.length} lead(s) foram pra Perdido (7 dias sem responder depois do reengajamento)\n\n` +
        `Quem responder vai aparecer em "Precisa de mim" ou ser atendido pela IA.`
    ).catch((err) => console.error("Falha ao mandar resumo do follow-up semanal:", err));
  }
}

let running = false;

async function tick() {
  if (running || getWhatsAppStatus() !== "READY") return;
  running = true;
  const now = new Date();
  try {
    await runDailySummary(now).catch((err) => console.error("Erro no resumo diário:", err));
    await runVisitConfirmations(now).catch((err) => console.error("Erro nas confirmações de visita:", err));
    await runWeeklyFollowUp(now).catch((err) => console.error("Erro no follow-up semanal:", err));
  } finally {
    running = false;
  }
}

export function startAutomations() {
  setInterval(tick, CHECK_INTERVAL_MS);
}
