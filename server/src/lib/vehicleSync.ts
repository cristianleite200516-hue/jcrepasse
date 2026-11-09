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
  for (const c of LEAD_COSTS) {
    const id = `lead-${lead.id}-${c.key}`;
    const amount = lead[c.field];
    if (amount && amount > 0) {
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
