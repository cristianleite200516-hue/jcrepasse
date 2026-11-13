import crypto from "crypto";
import { prisma } from "./prisma";

// Liga o lead comprado (status FECHADO com valor de compra) ao Histórico de Veículos, pra não
// precisar lançar o mesmo carro em dois lugares. As datas só são preenchidas se estiverem
// vazias no Histórico (quem ajustou a data lá não perde o ajuste).

type LeadForSync = {
  id: string;
  status: string;
  name: string | null;
  vehiclePlate: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  vehicleKm: number | null;
  vehicleInfo: string | null;
  purchasePrice: number | null;
  salePrice: number | null;
  fineDebts: number | null;
  ipvaDebt: number | null;
  prepCost: number | null;
  otherExpenses: number | null;
  resaleStatus: string;
  closedAt: Date | null;
  soldAt: Date | null;
};

export const LEAD_SYNC_SELECT = {
  id: true,
  status: true,
  name: true,
  vehiclePlate: true,
  vehicleBrand: true,
  vehicleModel: true,
  vehicleYear: true,
  vehicleKm: true,
  vehicleInfo: true,
  purchasePrice: true,
  salePrice: true,
  fineDebts: true,
  ipvaDebt: true,
  prepCost: true,
  otherExpenses: true,
  resaleStatus: true,
  closedAt: true,
  soldAt: true,
} as const;

export const isBought = (l: { status: string; purchasePrice: number | null } | null) =>
  !!l && l.status === "FECHADO" && l.purchasePrice != null;

const normalizePlate = (p: string | null) => (p ? p.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || null : null);

// Custos que o lead guarda em campos próprios viram gastos com id fixo (um por tipo).
const LEAD_COSTS = [
  { field: "ipvaDebt", key: "ipva", category: "IPVA", description: "IPVA (do lead)" },
  { field: "fineDebts", key: "multas", category: "Multas", description: "Multas (do lead)" },
  { field: "prepCost", key: "preparo", category: "Preparo", description: "Preparo (do lead)" },
  { field: "otherExpenses", key: "outras", category: "Outros", description: "Outras despesas (do lead)" },
] as const;

type CostKey = (typeof LEAD_COSTS)[number]["key"];

// Em qual campo de custo do lead cada tipo de gasto do Histórico entra (é o que a
// Rentabilidade e o Painel somam).
function bucketOf(category: string | null): CostKey {
  if (category === "IPVA") return "ipva";
  if (category === "Multas") return "multas";
  if (category && ["Preparo", "Funilaria", "Mecânica", "Pneu", "Lavagem/Estética"].includes(category)) return "preparo";
  return "outras";
}

/**
 * `wasBought`: se o lead já era compra antes desta alteração. O carro só é CRIADO na virada
 * (não-compra → compra); depois disso só é atualizado. Assim, se alguém apagar o carro do
 * Histórico, ele não volta sozinho a cada edição do lead.
 */
export async function syncVehicleFromLead(leadId: string, wasBought: boolean) {
  const lead = (await prisma.lead.findUnique({ where: { id: leadId }, select: LEAD_SYNC_SELECT })) as LeadForSync | null;
  if (!lead) return;

  let vehicle = await prisma.vehicle.findUnique({ where: { leadId } });
  const plate = normalizePlate(lead.vehiclePlate);

  if (!vehicle) {
    if (!isBought(lead) || wasBought) return;
    // Carro que já estava no Histórico (ex: veio da planilha) com a mesma placa: liga em vez de duplicar.
    if (plate) {
      const samePlate = await prisma.vehicle.findFirst({ where: { plate, leadId: null } });
      if (samePlate) vehicle = await prisma.vehicle.update({ where: { id: samePlate.id }, data: { leadId } });
    }
    if (!vehicle) {
      const model =
        [lead.vehicleBrand, lead.vehicleModel].filter(Boolean).join(" ") || lead.vehicleInfo || lead.name || "Veículo";
      vehicle = await prisma.vehicle.create({
        data: { leadId, source: "lead", model, plate, purchaseDate: lead.closedAt ?? new Date() },
      });
    }
  }

  // Carro criado pelo lead: o lead manda. Carro que já existia (planilha/manual): o lead só
  // preenche o que estiver vazio, pra não desfazer acertos feitos no Histórico.
  const fromLead = vehicle.source === "lead";
  const fill = <T,>(current: T | null, next: T | null) => (fromLead ? next : current ?? next);
  await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: {
      ...(plate && (fromLead || !vehicle.plate) ? { plate } : {}),
      ...(lead.vehicleYear && (fromLead || !vehicle.year) ? { year: lead.vehicleYear } : {}),
      ...(lead.vehicleKm != null && (fromLead || vehicle.km == null) ? { km: lead.vehicleKm } : {}),
      purchasePrice: fill(vehicle.purchasePrice, lead.purchasePrice),
      salePrice: fill(vehicle.salePrice, lead.salePrice),
      ...(!vehicle.purchaseDate && lead.closedAt ? { purchaseDate: lead.closedAt } : {}),
      ...(!vehicle.saleDate && lead.resaleStatus === "VENDIDO" && lead.soldAt ? { saleDate: lead.soldAt } : {}),
    },
  });

  // Só carros criados a partir do lead recebem os custos dele; os da planilha já trazem o custo lançado.
  if (vehicle.source !== "lead") return;
  // O campo de custo do lead já soma os gastos lançados à mão no Histórico (ver
  // syncLeadFromVehicle); o gasto "do lead" é só a diferença, pra não contar duas vezes.
  const others = await prisma.vehicleExpense.findMany({ where: { vehicleId: vehicle.id, NOT: { id: { startsWith: `lead-${lead.id}-` } } } });
  for (const c of LEAD_COSTS) {
    const id = `lead-${lead.id}-${c.key}`;
    const manual = others.filter((e) => bucketOf(e.category) === c.key).reduce((t, e) => t + e.amount, 0);
    const amount = (lead[c.field] ?? 0) - manual;
    if (amount > 0.005) {
      await prisma.vehicleExpense.upsert({
        where: { id },
        create: { id, vehicleId: vehicle.id, amount, category: c.category, description: c.description, date: vehicle.purchaseDate },
        update: { amount },
      });
    } else {
      await prisma.vehicleExpense.deleteMany({ where: { id } });
    }
  }
}

/**
 * Caminho de volta: o que é lançado no Histórico (valores, datas, venda, gastos) vai pro lead,
 * e assim aparece no Estoque, na Rentabilidade e no Painel. Carro do Histórico que ainda não
 * tem lead ganha um lead de estoque (`createIfMissing`). Escreve direto no banco, sem passar
 * pelo syncVehicleFromLead, então não volta em loop.
 */
export async function syncLeadFromVehicle(vehicleId: string, opts: { createIfMissing?: boolean; costsOnly?: boolean } = {}) {
  let vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, include: { expenses: true } });
  if (!vehicle) return null;

  let created = false;
  // Carro que já teve lead e o lead foi apagado de propósito: não recria.
  if (!vehicle.leadId && vehicle.source === "lead") return null;
  if (!vehicle.leadId) {
    if (!opts.createIfMissing) return null;
    // Já existe um lead com a mesma placa e sem carro no Histórico? Liga nele em vez de duplicar.
    const plate = normalizePlate(vehicle.plate);
    const samePlate = plate
      ? (await prisma.lead.findMany({ where: { vehiclePlate: { not: null }, vehicle: null }, select: { id: true, vehiclePlate: true } }))
          .find((l) => normalizePlate(l.vehiclePlate) === plate)
      : undefined;
    const lead = samePlate ?? await prisma.lead.create({
      data: {
        name: `Estoque — ${vehicle.model}`,
        phone: `estoque-${crypto.randomUUID()}`,
        source: "estoque",
        status: "FECHADO",
        resaleStatus: "EM_ESTOQUE",
        vehicleModel: vehicle.model,
        vehicleInfo: vehicle.model,
        closedAt: vehicle.purchaseDate ?? new Date(),
        conversation: { create: {} },
      },
    });
    vehicle = await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: { leadId: lead.id, source: "lead" },
      include: { expenses: true },
    });
    created = !samePlate;
  } else if (vehicle.source !== "lead") {
    // Histórico e lead viram espelho: o que muda num lado vai inteiro pro outro.
    vehicle = await prisma.vehicle.update({ where: { id: vehicle.id }, data: { source: "lead" }, include: { expenses: true } });
  }
  const leadId = vehicle.leadId!;

  const costs: Record<CostKey, number> = { ipva: 0, multas: 0, preparo: 0, outras: 0 };
  for (const e of vehicle.expenses) costs[bucketOf(e.category)] += e.amount;
  const costData = Object.fromEntries(LEAD_COSTS.map((c) => [c.field, costs[c.key] > 0 ? Math.round(costs[c.key] * 100) / 100 : null]));

  const current = await prisma.lead.findUnique({ where: { id: leadId }, select: { resaleStatus: true, status: true, soldAt: true } });
  if (!current) return null;

  const data: Record<string, unknown> = { ...costData };
  if (!opts.costsOnly) {
    Object.assign(data, {
      // Carro no Histórico = carro comprado: lead fica como fechado pra aparecer no Estoque.
      ...(current.status !== "FECHADO" && current.status !== "GANHO" ? { status: "FECHADO" } : {}),
      purchasePrice: vehicle.purchasePrice,
      salePrice: vehicle.salePrice,
      ...(vehicle.plate ? { vehiclePlate: vehicle.plate } : {}),
      ...(vehicle.year ? { vehicleYear: vehicle.year } : {}),
      ...(vehicle.km != null ? { vehicleKm: vehicle.km } : {}),
      ...(vehicle.purchaseDate ? { closedAt: vehicle.purchaseDate } : {}),
    });
    // Mesma regra do Histórico: tem data OU valor de venda = vendido.
    if (vehicle.saleDate || vehicle.salePrice != null) {
      data.resaleStatus = "VENDIDO";
      data.soldAt = vehicle.saleDate ?? current.soldAt ?? null;
    } else if (current.resaleStatus === "VENDIDO") {
      data.resaleStatus = "EM_ESTOQUE";
      data.soldAt = null;
    }
  }

  const lead = await prisma.lead.update({ where: { id: leadId }, data, include: { assignedTo: { select: { id: true, name: true } } } });
  return { lead, created };
}

// Ao subir o servidor: todo carro do Histórico ganha (ou acerta) seu lead, pra Estoque,
// Rentabilidade e Painel mostrarem o mesmo que o Histórico — inclusive os lançados antes disso.
export async function backfillLeadsFromVehicles() {
  const all = await prisma.vehicle.findMany({ select: { id: true } });
  for (const v of all) {
    try {
      await syncLeadFromVehicle(v.id, { createIfMissing: true });
    } catch (err) {
      console.error("Erro ao levar carro do Histórico pro Estoque:", v.id, err);
    }
  }
}
