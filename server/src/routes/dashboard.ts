import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireAdmin } from "../middleware/auth";

export const dashboardRouter = Router();
// O dashboard expõe faturamento e lucro — restrito a administradores.
dashboardRouter.use(requireAuth, requireAdmin);

const STATUSES = ["NOVO", "CONTATADO", "QUALIFICADO", "PROPOSTA", "GANHO", "FECHADO", "PERDIDO"];

dashboardRouter.get("/stats", async (_req, res) => {
  const leads = await prisma.lead.findMany();
  const conversations = await prisma.conversation.findMany({
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const leadsByStatus: Record<string, number> = {};
  for (const s of STATUSES) leadsByStatus[s] = 0;
  for (const l of leads) leadsByStatus[l.status] = (leadsByStatus[l.status] ?? 0) + 1;

  const lossReasons: Record<string, number> = {};
  for (const l of leads) {
    if (l.status !== "PERDIDO") continue;
    const reason = l.lossReason?.trim() || "Não informado";
    lossReasons[reason] = (lossReasons[reason] ?? 0) + 1;
  }

  const CHANNEL_LABELS: Record<string, string> = {
    TRAFEGO_PAGO: "Tráfego pago",
    INDICACAO: "Indicação",
    OUTRO: "Outro canal",
  };
  const leadsByChannel: Record<string, number> = {};
  for (const l of leads) {
    const label = l.channel ? CHANNEL_LABELS[l.channel] ?? l.channel : "Não informado";
    leadsByChannel[label] = (leadsByChannel[label] ?? 0) + 1;
  }

  const totalLeads = leads.length;
  const qualificados = leadsByStatus["QUALIFICADO"] ?? 0;
  const fechados = leadsByStatus["FECHADO"] ?? 0;
  const conversao = totalLeads > 0 ? (fechados / totalLeads) * 100 : 0;

  const comMensagem = conversations.filter((c) => c.messages.length > 0);
  const respondidos = comMensagem.filter((c) => c.messages[0].sender !== "LEAD").length;
  const aguardando = comMensagem.filter((c) => c.messages[0].sender === "LEAD").length;

  const closedDeals = leads.filter((l) => l.status === "FECHADO" && l.purchasePrice != null && l.salePrice != null);
  const profits = closedDeals.map(
    (l) =>
      (l.salePrice ?? 0) -
      (l.purchasePrice ?? 0) -
      (l.fineDebts ?? 0) -
      (l.ipvaDebt ?? 0) -
      (l.otherExpenses ?? 0) -
      (l.prepCost ?? 0)
  );
  const lucroTotal = profits.reduce((a, b) => a + b, 0);
  const lucroMedio = profits.length > 0 ? lucroTotal / profits.length : 0;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const upcomingAppointments = await prisma.appointment.findMany({
    where: { scheduledAt: { gte: startOfToday }, status: { not: "CANCELADO" } },
    include: { lead: { select: { id: true, name: true, phone: true, vehicleBrand: true, vehicleModel: true, vehicleYear: true, vehicleInfo: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 5,
  });

  const agendamentosHoje = await prisma.appointment.count({
    where: { scheduledAt: { gte: startOfToday, lt: endOfToday }, status: { not: "CANCELADO" } },
  });

  // Performance por vendedor: taxa de conversão e tempo médio de resposta manual (agente)
  // a partir do momento em que o lead escreve.
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const leadsWithAgent = await prisma.lead.findMany({
    where: { assignedToId: { not: null } },
    select: {
      assignedToId: true,
      status: true,
      conversation: { select: { messages: { select: { sender: true, createdAt: true }, orderBy: { createdAt: "asc" } } } },
    },
  });

  const perAgent: Record<string, { totalLeads: number; fechados: number; responseMs: number[] }> = {};
  for (const lead of leadsWithAgent) {
    const uid = lead.assignedToId as string;
    perAgent[uid] ??= { totalLeads: 0, fechados: 0, responseMs: [] };
    perAgent[uid].totalLeads++;
    if (lead.status === "FECHADO") perAgent[uid].fechados++;

    const msgs = lead.conversation?.messages ?? [];
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].sender === "LEAD" && msgs[i + 1].sender === "AGENT") {
        perAgent[uid].responseMs.push(msgs[i + 1].createdAt.getTime() - msgs[i].createdAt.getTime());
      }
    }
  }

  const agentPerformance = users
    .map((u) => {
      const stats = perAgent[u.id] ?? { totalLeads: 0, fechados: 0, responseMs: [] };
      return {
        userId: u.id,
        name: u.name,
        totalLeads: stats.totalLeads,
        fechados: stats.fechados,
        conversao: stats.totalLeads > 0 ? (stats.fechados / stats.totalLeads) * 100 : 0,
        tempoMedioRespostaMin:
          stats.responseMs.length > 0
            ? stats.responseMs.reduce((a, b) => a + b, 0) / stats.responseMs.length / 60000
            : null,
      };
    })
    .filter((a) => a.totalLeads > 0)
    .sort((a, b) => b.totalLeads - a.totalLeads);

  res.json({
    totalLeads,
    leadsByStatus,
    lossReasons,
    leadsByChannel,
    qualificados,
    fechados,
    conversao,
    respondidos,
    aguardando,
    lucroTotal,
    lucroMedio,
    negociosComLucroCalculado: profits.length,
    agendamentosHoje,
    proximosAgendamentos: upcomingAppointments,
    agentPerformance,
  });
});

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

dashboardRouter.get("/monthly", async (req, res) => {
  const months = Math.min(Number(req.query.months) || 12, 24);

  const now = new Date();
  const monthKeys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(monthKey(d));
  }
  const earliest = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  const [leads, appointments] = await Promise.all([
    prisma.lead.findMany({
      where: {
        OR: [{ createdAt: { gte: earliest } }, { closedAt: { gte: earliest } }],
      },
      select: { createdAt: true, closedAt: true, salePrice: true, purchasePrice: true, fineDebts: true, ipvaDebt: true, otherExpenses: true, prepCost: true },
    }),
    prisma.appointment.findMany({
      where: { scheduledAt: { gte: earliest } },
      select: { scheduledAt: true, status: true },
    }),
  ]);

  const byMonth: Record<
    string,
    { leads: number; agendamentos: number; visitas: number; fechamentos: number; faturamento: number }
  > = {};
  for (const key of monthKeys) byMonth[key] = { leads: 0, agendamentos: 0, visitas: 0, fechamentos: 0, faturamento: 0 };

  for (const lead of leads) {
    const createdKey = monthKey(lead.createdAt);
    if (byMonth[createdKey]) byMonth[createdKey].leads++;

    if (lead.closedAt) {
      const closedKey = monthKey(lead.closedAt);
      if (byMonth[closedKey]) {
        byMonth[closedKey].fechamentos++;
        if (lead.salePrice != null) byMonth[closedKey].faturamento += lead.salePrice;
      }
    }
  }

  for (const appt of appointments) {
    const key = monthKey(appt.scheduledAt);
    if (!byMonth[key]) continue;
    byMonth[key].agendamentos++;
    if (appt.status === "REALIZADO") byMonth[key].visitas++;
  }

  const result = monthKeys.map((key) => ({ month: key, ...byMonth[key] }));
  res.json(result);
});
