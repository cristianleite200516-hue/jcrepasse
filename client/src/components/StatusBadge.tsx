import { LeadStatus, STATUS_LABELS } from "../lib/types";

const COLORS: Record<LeadStatus, string> = {
  NOVO: "bg-slate-100 text-slate-600",
  CONTATADO: "bg-blue-500/15 text-blue-700",
  QUALIFICADO: "bg-amber-500/15 text-amber-700",
  PROPOSTA: "bg-purple-500/15 text-purple-700",
  GANHO: "bg-green-500/15 text-green-700",
  FECHADO: "bg-emerald-600 text-white",
  PERDIDO: "bg-red-500/15 text-red-600",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
