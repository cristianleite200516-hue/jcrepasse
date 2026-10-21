import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { LEAD_STATUSES, STATUS_LABELS, Appointment } from "../lib/types";
import { MonthlyComparison } from "../components/MonthlyComparison";
import { BarChart } from "../components/charts/BarChart";
import { maskCurrency, useHideMoney } from "../lib/useHideMoney";

interface AgentPerformance {
  userId: string;
  name: string;
  totalLeads: number;
  fechados: number;
  conversao: number;
  tempoMedioRespostaMin: number | null;
}

interface Stats {
  totalLeads: number;
  leadsByStatus: Record<string, number>;
  lossReasons: Record<string, number>;
  leadsByChannel: Record<string, number>;
  qualificados: number;
  fechados: number;
  conversao: number;
  respondidos: number;
  aguardando: number;
  lucroTotal: number;
  lucroMedio: number;
  negociosComLucroCalculado: number;
  agendamentosHoje: number;
  proximosAgendamentos: Appointment[];
  agentPerformance: AgentPerformance[];
}

function fmtTempo(min: number | null) {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const horas = min / 60;
  if (horas < 24) return `${horas.toFixed(1)} h`;
  return `${(horas / 24).toFixed(1)} dias`;
}

function fmtCurrency(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function vehicleLabel(lead: Appointment["lead"]) {
  const parts = [lead.vehicleBrand, lead.vehicleModel, lead.vehicleYear].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return lead.vehicleInfo || "—";
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  const toneClass =
    tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

export function Analytics() {
  const [stats, setStats] = useState<Stats | null>(null);
  const { hidden } = useHideMoney();

  useEffect(() => {
    api.get("/dashboard/stats").then((res) => setStats(res.data));
  }, []);

  if (!stats) return <div className="text-sm text-slate-500">Carregando...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-slate-900">Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Leads que chegaram" value={String(stats.totalLeads)} />
        <StatCard label="Leads respondidos" value={String(stats.respondidos)} />
        <StatCard label="Aguardando resposta" value={String(stats.aguardando)} tone={stats.aguardando > 0 ? "bad" : "neutral"} />
        <StatCard label="Leads qualificados" value={String(stats.qualificados)} />
        <StatCard label="Negócios fechados" value={String(stats.fechados)} />
        <StatCard label="Taxa de conversão" value={`${stats.conversao.toFixed(1)}%`} />
        <StatCard
          label="Lucro total (fechados)"
          value={maskCurrency(hidden, fmtCurrency(stats.lucroTotal))}
          tone={stats.lucroTotal >= 0 ? "good" : "bad"}
        />
        <StatCard
          label="Lucro médio por negócio"
          value={stats.negociosComLucroCalculado > 0 ? maskCurrency(hidden, fmtCurrency(stats.lucroMedio)) : "—"}
          tone={stats.lucroMedio >= 0 ? "good" : "bad"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 text-sm font-semibold text-slate-600">Funil por status</div>
          <BarChart
            orientation="horizontal"
            color="#2a78d6"
            data={LEAD_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: stats.leadsByStatus[s] ?? 0 }))}
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-600">Próximas avaliações</span>
            <span className="text-xs text-slate-500">
              {stats.agendamentosHoje} hoje ·{" "}
              <Link to="/agendamentos" className="text-slate-900 hover:underline">
                ver todos
              </Link>
            </span>
          </div>
          <div className="space-y-2">
            {stats.proximosAgendamentos.length === 0 && (
              <div className="text-xs text-slate-500">Nenhuma avaliação agendada</div>
            )}
            {stats.proximosAgendamentos.map((a) => (
              <Link
                key={a.id}
                to={`/leads/${a.leadId}`}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-slate-100"
              >
                <div>
                  <div className="font-medium text-slate-800">{a.lead.name || "Sem nome"}</div>
                  <div className="text-slate-500">{vehicleLabel(a.lead)}</div>
                </div>
                <div className="text-right text-slate-500">
                  <div>{new Date(a.scheduledAt).toLocaleDateString("pt-BR")}</div>
                  <div>{new Date(a.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 text-sm font-semibold text-slate-600">Leads por canal</div>
          <BarChart
            orientation="horizontal"
            color="#2a78d6"
            data={Object.entries(stats.leadsByChannel)
              .sort((a, b) => b[1] - a[1])
              .map(([label, value]) => ({ label, value }))}
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 text-sm font-semibold text-slate-600">Motivos de perda</div>
          {Object.keys(stats.lossReasons).length === 0 ? (
            <div className="text-xs text-slate-500">Nenhum lead perdido ainda</div>
          ) : (
            <BarChart
              orientation="horizontal"
              color="#dc2626"
              data={Object.entries(stats.lossReasons)
                .sort((a, b) => b[1] - a[1])
                .map(([label, value]) => ({ label, value }))}
            />
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 text-sm font-semibold text-slate-600">Performance por vendedor</div>
          {stats.agentPerformance.length === 0 ? (
            <div className="text-xs text-slate-500">Nenhum lead com responsável ainda</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left uppercase text-slate-500">
                  <tr>
                    <th className="pb-2">Vendedor</th>
                    <th className="pb-2 text-right">Leads</th>
                    <th className="pb-2 text-right">Fechados</th>
                    <th className="pb-2 text-right">Conversão</th>
                    <th className="pb-2 text-right">Tempo médio de resposta</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.agentPerformance.map((a) => (
                    <tr key={a.userId} className="border-t border-slate-200">
                      <td className="py-1.5 text-slate-800">{a.name}</td>
                      <td className="py-1.5 text-right text-slate-600">{a.totalLeads}</td>
                      <td className="py-1.5 text-right text-slate-600">{a.fechados}</td>
                      <td className="py-1.5 text-right text-slate-600">{a.conversao.toFixed(1)}%</td>
                      <td className="py-1.5 text-right text-slate-600">{fmtTempo(a.tempoMedioRespostaMin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <MonthlyComparison />
    </div>
  );
}
