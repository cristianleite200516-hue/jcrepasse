import { prisma } from "./prisma";
import { getIO } from "./events";

// Até a correção de fuso (deploy de 01/10/2026 às 20:49 de Brasília), os horários que a IA
// combinava ("2026-10-02T14:00") eram lidos como UTC, e a visita ficava gravada 3h antes do
// combinado. As visitas da IA são reconhecidas pelo texto que ela sempre põe nas observações. As
// corrigidas ganham uma marca no fim das observações, pra nunca somar as 3h duas vezes.
const FIX_DEPLOYED_AT = new Date("2026-10-01T23:49:25Z");
const AI_NOTE_PREFIXES = ["Visita na loja", "Avaliação no endereço do lead"];
const FIXED_MARKER = "(horário corrigido +3h)";
const OFFSET_MS = 3 * 60 * 60 * 1000;

async function findCandidates() {
  return prisma.appointment.findMany({
    where: {
      createdAt: { lt: FIX_DEPLOYED_AT },
      OR: AI_NOTE_PREFIXES.map((prefix) => ({ notes: { startsWith: prefix } })),
      NOT: { notes: { contains: FIXED_MARKER } },
    },
    include: { lead: { select: { id: true, name: true, phone: true, vehicleInfo: true } } },
    orderBy: { scheduledAt: "asc" },
  });
}

export async function previewAppointmentTzFix() {
  const candidates = await findCandidates();
  return candidates.map((a) => ({
    id: a.id,
    leadId: a.lead.id,
    leadName: a.lead.name,
    leadPhone: a.lead.phone,
    vehicleInfo: a.lead.vehicleInfo,
    status: a.status,
    notes: a.notes,
    currentAt: a.scheduledAt,
    correctedAt: new Date(a.scheduledAt.getTime() + OFFSET_MS),
  }));
}

export async function applyAppointmentTzFix() {
  const candidates = await findCandidates();
  for (const a of candidates) {
    const updated = await prisma.appointment.update({
      where: { id: a.id },
      data: {
        scheduledAt: new Date(a.scheduledAt.getTime() + OFFSET_MS),
        notes: `${a.notes ?? ""} ${FIXED_MARKER}`.trim(),
      },
      include: { lead: { select: { id: true, name: true, phone: true, vehicleBrand: true, vehicleModel: true, vehicleYear: true, vehicleInfo: true } } },
    });
    getIO().emit("appointment:updated", updated);
  }
  return { fixed: candidates.length };
}
