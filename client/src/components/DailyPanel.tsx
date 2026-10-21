import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { LEAD_STATUSES, STATUS_LABELS, LeadStatus } from "../lib/types";

interface AtRiskLead {
  id: string;
  name: string | null;
  phone: string;
  status: LeadStatus;
  updatedAt: string;
  vehicleInfo: string | null;
  assignedTo: { id: string; name: string } | null;
}

interface GoalProgress {
  userId: string;
  name: string;
  goal: number;
  closedToday: number;
}

interface DailyData {
  leadsByStatus: Record<string, number>;
  totalLeads: number;
  agendaramVisita: number;
  taxaAgendamento: number;
  atRisk: AtRiskLead[];
  fechadosHoje: number;
  metaFechamentos: number | null;
  myGoal: GoalProgress | null;
  teamProgress: GoalProgress[];
}

function diasParados(iso: string) {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  return dias;
}

export function DailyPanel() {
  const [data, setData] = useState<DailyData | null>(null);
  const [showAtRisk, setShowAtRisk] = useState(false);

  async function load() {
    const res = await api.get("/daily");
    setData(res.data);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    socket.on("lead:created", load);
    socket.on("lead:updated", load);
    socket.on("appointment:created", load);
    socket.on("appointment:updated", load);
    socket.on("reminder:created", load);
    socket.on("reminder:updated", load);
    return () => {
      socket.off("lead:created", load);
      socket.off("lead:updated", load);
      socket.off("appointment:created", load);
      socket.off("appointment:updated", load);
      socket.off("reminder:created", load);
      socket.off("reminder:updated", load);
    };
  }, []);

  if (!data) return null;

  const metaAtingida = data.metaFechamentos != null && data.fechadosHoje >= data.metaFechamentos;

  return (
    <div className="mb-4 space-y-2">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Fechamentos hoje</div>
          <div className={`mt-1 text-2xl font-bold ${metaAtingida ? "text-emerald-600" : "text-slate-900"}`}>
            {data.fechadosHoje}
            {data.metaFechamentos != null && (
              <span className="text-base font-normal text-slate-500"> / {data.metaFechamentos}</span>
            )}
          </div>
          {data.metaFechamentos == null && (
            <div className="mt-1 text-[11px] text-slate-500">
              Defina uma meta em{" "}
              <Link to="/settings" className="underline">
                Configurações
              </Link>
            </div>
          )}
          {metaAtingida && <div className="mt-1 text-[11px] text-emerald-600">Meta batida hoje! 🎯</div>}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Converteram em visita/avaliação</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {data.agendaramVisita}
            <span className="text-base font-normal text-slate-500"> de {data.totalLeads}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">{data.taxaAgendamento.toFixed(1)}% dos leads</div>
        </div>

        <button
          type="button"
          onClick={() => setShowAtRisk((v) => !v)}
          className={`rounded-lg border p-4 text-left transition-colors ${
            data.atRisk.length > 0
              ? "border-red-500/40 bg-red-500/10 hover:bg-red-500/15"
              : "border-slate-200 bg-white"
          }`}
        >
          <div className="text-xs text-slate-500">Leads sem retorno (risco de abandono)</div>
          <div className={`mt-1 text-2xl font-bold ${data.atRisk.length > 0 ? "text-red-600" : "text-emerald-600"}`}>
            {data.atRisk.length}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {data.atRisk.length > 0 ? (showAtRisk ? "clique pra ocultar ▲" : "clique pra ver quem ▼") : "nenhum, mandou bem!"}
          </div>
        </button>
      </div>

      {data.teamProgress.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 text-xs font-semibold text-slate-500">Metas individuais de hoje</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {data.teamProgress.map((t) => {
              const pct = Math.min(100, (t.closedToday / t.goal) * 100);
              const batida = t.closedToday >= t.goal;
              const isMe = data.myGoal?.userId === t.userId;
              return (
                <div key={t.userId} className={`rounded-md px-2 py-1.5 text-xs ${isMe ? "bg-slate-50 ring-1 ring-emerald-500/40" : "bg-slate-50"}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-slate-600">
                      {t.name}
                      {isMe && " (você)"}
                    </span>
                    <span className={batida ? "text-emerald-600" : "text-slate-500"}>
                      {t.closedToday}/{t.goal}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white">
                    <div
                      className={`h-full rounded-full ${batida ? "bg-emerald-500" : "bg-indigo-500"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-2 text-xs font-semibold text-slate-500">Funil de leads</div>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {LEAD_STATUSES.filter((s) => s !== "PERDIDO").map((s, i, arr) => (
            <div key={s} className="flex items-center gap-1">
              <div className="rounded-md bg-slate-50 px-2 py-1">
                <span className="text-slate-500">{STATUS_LABELS[s]}</span>{" "}
                <span className="font-semibold text-slate-900">{data.leadsByStatus[s] ?? 0}</span>
              </div>
              {i < arr.length - 1 && <span className="text-slate-600">→</span>}
            </div>
          ))}
        </div>
      </div>

      {showAtRisk && data.atRisk.length > 0 && (
        <div className="rounded-lg border border-red-500/40 bg-white p-4">
          <div className="mb-2 text-xs font-semibold text-red-600">
            Sem contato há mais de 2 dias, sem lembrete e sem visita/avaliação marcada — não deixa esfriar
          </div>
          <div className="space-y-1">
            {data.atRisk.map((l) => (
              <Link
                key={l.id}
                to={`/leads/${l.id}`}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-slate-100"
              >
                <div>
                  <span className="font-medium text-slate-800">{l.name || "Sem nome"}</span>{" "}
                  <span className="text-slate-500">{l.vehicleInfo || ""}</span>
                </div>
                <div className="text-right text-slate-500">
                  <span>{STATUS_LABELS[l.status]}</span> · <span>{diasParados(l.updatedAt)}d parado</span>
                  {l.assignedTo && <> · {l.assignedTo.name}</>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
