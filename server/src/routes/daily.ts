import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";

// Painel do dia — visível a toda a equipe (não só admin), pra manter o foco em não
// abandonar leads, converter em visita/avaliação e fechar negócios todos os dias.
export const dailyRouter = Router();
dailyRouter.use(requireAuth);

const ACTIVE_STATUSES = ["NOVO", "CONTATADO", "QUALIFICADO", "PROPOSTA"];
const STATUSES = ["NOVO", "CONTATADO", "QUALIFICADO", "PROPOSTA", "GANHO", "FECHADO", "PERDIDO"];

// Leads sem contato recente, sem lembrete pendente e sem visita/avaliação agendada —
// candidatos a serem esquecidos.
const STALE_DAYS = 2;

dailyRouter.get("/", async (req: AuthedRequest, res) => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const staleThreshold = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000);

  const leads = await prisma.lead.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      updatedAt: true,
      vehicleInfo: true,
      vehicleBrand: true,
      vehicleModel: true,
      assignedTo: { select: { id: true, name: true } },
      appointments: { select: { id: true, status: true } },
      reminders: { select: { id: true, done: true } },
    },
  });

  const leadsByStatus: Record<string, number> = {};
  for (const s of STATUSES) leadsByStatus[s] = 0;
  for (const l of leads) leadsByStatus[l.status] = (leadsByStatus[l.status] ?? 0) + 1;

  const totalLeads = leads.length;
  const comAgendamento = leads.filter((l) => l.appointments.some((a) => a.status !== "CANCELADO"));
  const taxaAgendamento = totalLeads > 0 ? (comAgendamento.length / totalLeads) * 100 : 0;

  const atRisk = leads
    .filter((l) => {
      if (!ACTIVE_STATUSES.includes(l.status)) return false;
      const temAgendamento = l.appointments.some((a) => a.status !== "CANCELADO");
      const temLembretePendente = l.reminders.some((r) => !r.done);
      const semAtividadeRecente = l.updatedAt < staleThreshold;
      return !temAgendamento && !temLembretePendente && semAtividadeRecente;
    })
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    .map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      status: l.status,
      updatedAt: l.updatedAt,
      vehicleInfo: [l.vehicleBrand, l.vehicleModel].filter(Boolean).join(" ") || l.vehicleInfo,
      assignedTo: l.assignedTo,
    }));

  const fechadosHoje = await prisma.lead.count({
    where: { closedAt: { gte: startOfToday, lt: endOfToday } },
  });

  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });

  // Progresso individual por vendedor — fechamentos de hoje contra a meta de cada um,
  // só de quem tem meta definida (evita poluir o painel com quem não usa isso).
  const usersWithGoal = await prisma.user.findMany({
    where: { dailyGoal: { not: null } },
    select: { id: true, name: true, dailyGoal: true },
  });
  const closedTodayLeads = await prisma.lead.findMany({
    where: { closedAt: { gte: startOfToday, lt: endOfToday } },
    select: { assignedToId: true },
  });
  const teamProgress = usersWithGoal
    .map((u) => ({
      userId: u.id,
      name: u.name,
      goal: u.dailyGoal as number,
      closedToday: closedTodayLeads.filter((l) => l.assignedToId === u.id).length,
    }))
    .sort((a, b) => b.closedToday / b.goal - a.closedToday / a.goal);

  const me = teamProgress.find((t) => t.userId === req.user?.id) ?? null;

  res.json({
    leadsByStatus,
    totalLeads,
    agendaramVisita: comAgendamento.length,
    taxaAgendamento,
    atRisk,
    fechadosHoje,
    metaFechamentos: settings?.dailyClosingGoal ?? null,
    myGoal: me,
    teamProgress,
  });
});
