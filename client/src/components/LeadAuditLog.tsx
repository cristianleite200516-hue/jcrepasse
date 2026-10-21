import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { STATUS_LABELS, LeadStatus } from "../lib/types";

interface AuditEntry {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  user: { id: string; name: string } | null;
}

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  purchasePrice: "Valor de compra",
  salePrice: "Valor de venda",
  assignedToId: "Responsável",
  lossReason: "Motivo da perda",
};

function fmtValue(field: string, value: string | null, team: { id: string; name: string }[]) {
  if (value == null || value === "") return "—";
  if (field === "status") return STATUS_LABELS[value as LeadStatus] ?? value;
  if (field === "assignedToId") return team.find((t) => t.id === value)?.name ?? value;
  if (field === "purchasePrice" || field === "salePrice") {
    const n = Number(value);
    return Number.isNaN(n) ? value : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  return value;
}

export function LeadAuditLog({ leadId }: { leadId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.get("/auth/team").then((res) => setTeam(res.data));
  }, []);

  useEffect(() => {
    if (!open) return;
    api.get(`/leads/${leadId}/audit-log`).then((res) => setEntries(res.data));
  }, [leadId, open]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-semibold text-slate-600"
      >
        <span>Histórico de alterações</span>
        <span className="text-xs text-slate-500">{open ? "ocultar ▲" : "mostrar ▼"}</span>
      </button>
      {open && (
        <div className="space-y-1.5">
          {entries.length === 0 && <div className="text-xs text-slate-500">Nenhuma alteração registrada ainda</div>}
          {entries.map((e) => (
            <div key={e.id} className="text-xs text-slate-500">
              <span className="text-slate-600">{FIELD_LABELS[e.field] ?? e.field}</span>{" "}
              {fmtValue(e.field, e.oldValue, team)} → <span className="text-slate-800">{fmtValue(e.field, e.newValue, team)}</span>
              <div className="text-[10px] text-slate-500">
                {e.user?.name ?? "Sistema"} · {new Date(e.createdAt).toLocaleString("pt-BR")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
