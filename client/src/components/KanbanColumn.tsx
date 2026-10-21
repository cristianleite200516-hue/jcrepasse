import { useState } from "react";
import { Lead, LeadStatus, STATUS_LABELS } from "../lib/types";
import { LeadCard } from "./LeadCard";

const HEADER_COLORS: Partial<Record<LeadStatus, string>> = {
  CONTATADO: "text-blue-600",
  QUALIFICADO: "text-amber-600",
  PROPOSTA: "text-purple-600",
  GANHO: "text-green-600",
  FECHADO: "text-emerald-600",
  PERDIDO: "text-red-600",
};

export function KanbanColumn({
  status,
  leads,
  onDropLead,
}: {
  status: LeadStatus;
  leads: Lead[];
  onDropLead: (leadId: string, status: LeadStatus) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const leadId = e.dataTransfer.getData("text/lead-id");
        if (leadId) onDropLead(leadId, status);
      }}
      className={`flex w-72 shrink-0 flex-col rounded-lg border transition-colors ${
        dragOver ? "border-emerald-500 bg-emerald-500/10" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h3 className={`font-semibold text-sm ${HEADER_COLORS[status] ?? "text-slate-600"}`}>{STATUS_LABELS[status]}</h3>
        <span className="text-xs text-slate-500">{leads.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-2 overflow-y-auto max-h-[70vh] min-h-[80px]">
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}
        {leads.length === 0 && (
          <div className="text-xs text-slate-500 text-center py-4">Arraste um lead aqui</div>
        )}
      </div>
    </div>
  );
}
