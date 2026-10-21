import { prisma } from "./prisma";
import { getIO } from "./events";

// Limpeza dos agendamentos duplicados que a IA criou antes de passar a conferir o que já existia.
// Só mexe em AGENDADO/CONFIRMADO e só CANCELA (nunca apaga), então dá pra reverter na própria tela.
// Dois casos, por lead:
//  1. Mesmo horário repetido: fica um só (prefere o Confirmado, senão o mais recente).
//  2. Remarcação: o agendamento antigo ainda estava no futuro quando o novo foi criado, então o novo
//     o substituiu. Se o antigo já tinha passado quando o novo foi criado, não é remarcação e fica.

export interface DuplicateGroup {
  leadId: string;
  leadName: string | null;
  leadPhone: string;
  vehicleInfo: string | null;
  keep: { id: string; scheduledAt: Date; status: string; notes: string | null };
  cancel: { id: string; scheduledAt: Date; status: string; reason: "MESMO_HORARIO" | "REMARCADO" }[];
}

async function findDuplicates(): Promise<DuplicateGroup[]> {
  const appointments = await prisma.appointment.findMany({
    where: { status: { in: ["AGENDADO", "CONFIRMADO"] } },
    include: { lead: { select: { id: true, name: true, phone: true, vehicleInfo: true } } },
    orderBy: { createdAt: "asc" },
  });

  const byLead = new Map<string, typeof appointments>();
  for (const a of appointments) {
    const list = byLead.get(a.leadId) ?? [];
    list.push(a);
    byLead.set(a.leadId, list);
  }

  const groups: DuplicateGroup[] = [];
  for (const list of byLead.values()) {
    if (list.length < 2) continue;
    const cancelled = new Map<string, "MESMO_HORARIO" | "REMARCADO">();

    // 1) mesmo horário
    const byTime = new Map<number, typeof list>();
    for (const a of list) {
      const key = a.scheduledAt.getTime();
      byTime.set(key, [...(byTime.get(key) ?? []), a]);
    }
    const survivors: typeof list = [];
    for (const same of byTime.values()) {
      const best = [...same].sort(
        (x, y) =>
          Number(y.status === "CONFIRMADO") - Number(x.status === "CONFIRMADO") ||
          y.createdAt.getTime() - x.createdAt.getTime()
      )[0];
      survivors.push(best);
      for (const a of same) if (a.id !== best.id) cancelled.set(a.id, "MESMO_HORARIO");
    }

    // 2) remarcação: antigo ainda pendente (no futuro) quando um mais novo foi criado
    survivors.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
    for (let i = 0; i < survivors.length - 1; i++) {
      const old = survivors[i];
      const replaced = survivors.slice(i + 1).some((newer) => newer.createdAt.getTime() < old.scheduledAt.getTime());
      if (replaced) cancelled.set(old.id, "REMARCADO");
    }

    if (cancelled.size === 0) continue;
    const keep = list
      .filter((a) => !cancelled.has(a.id))
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];
    if (!keep) continue; // nunca cancela todos os agendamentos de um lead
    groups.push({
      leadId: keep.lead.id,
      leadName: keep.lead.name,
      leadPhone: keep.lead.phone,
      vehicleInfo: keep.lead.vehicleInfo,
      keep: { id: keep.id, scheduledAt: keep.scheduledAt, status: keep.status, notes: keep.notes },
      cancel: list
        .filter((a) => cancelled.has(a.id))
        .map((a) => ({ id: a.id, scheduledAt: a.scheduledAt, status: a.status, reason: cancelled.get(a.id)! })),
    });
  }
  return groups;
}

export async function previewAppointmentDedupe() {
  return findDuplicates();
}

export async function applyAppointmentDedupe() {
  const groups = await findDuplicates();
  let cancelled = 0;
  for (const g of groups) {
    for (const c of g.cancel) {
      const updated = await prisma.appointment.update({
        where: { id: c.id },
        data: { status: "CANCELADO" },
        include: {
          lead: { select: { id: true, name: true, phone: true, vehicleBrand: true, vehicleModel: true, vehicleYear: true, vehicleInfo: true } },
        },
      });
      getIO().emit("appointment:updated", updated);
      cancelled++;
    }
  }
  return { cancelled, leads: groups.length };
}
