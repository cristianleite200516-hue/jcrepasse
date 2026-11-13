import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { Lead, STATUS_LABELS, TEAM_NAMES } from "../lib/types";
import { maskCurrency, useHideMoney } from "../lib/useHideMoney";

type SortMode = "lucro" | "recentes" | "margem";
type PeriodMode = "semana" | "mes" | "tudo";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ddmm = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

// Semana de segunda a domingo; offset 0 = atual, -1 = anterior...
function periodRange(mode: PeriodMode, offset: number) {
  const now = new Date();
  if (mode === "mes") {
    const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    return { from, to, label: `${MESES[from.getMonth()]} de ${from.getFullYear()}` };
  }
  if (mode === "semana") {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + 7 * offset);
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
    return { from, to, label: `${ddmm(from)} a ${ddmm(new Date(to.getTime() - 86400000))}` };
  }
  return { from: new Date(2000, 0, 1), to: new Date(now.getFullYear() + 1, 0, 1), label: "todo o período" };
}

interface FunnelData {
  chegaram: number;
  contatados: number;
  qualificados: number;
  proposta: number;
  comprados: number;
  perdidos: number;
}

function Funnel({ from, to, vendidos, compradosTotal }: { from: Date; to: Date; vendidos: number; compradosTotal: number }) {
  const [data, setData] = useState<FunnelData | null>(null);
  const fromMs = from.getTime();
  const toMs = to.getTime();
  useEffect(() => {
    setData(null);
    api
      .get("/dashboard/funnel", { params: { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() } })
      .then((res) => setData(res.data))
      .catch(() => setData(null));
  }, [fromMs, toMs]);

  const steps = data
    ? [
        { label: "Leads que chegaram", value: data.chegaram },
        { label: "Contatados", value: data.contatados },
        { label: "Qualificados", value: data.qualificados },
        { label: "Proposta", value: data.proposta },
        { label: "Compramos o carro", value: data.comprados },
      ]
    : [];
  const top = Math.max(1, data?.chegaram ?? 1);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-600">Funil do período</span>
        <span className="text-xs text-slate-500">dos leads que chegaram no período, até onde cada um já foi</span>
      </div>
      {!data ? (
        <div className="text-xs text-slate-500">Carregando...</div>
      ) : (
        <div className="space-y-2">
          {steps.map((st, i) => {
            const pct = (st.value / top) * 100;
            const prev = i > 0 ? steps[i - 1].value : null;
            return (
              <div key={st.label} className="flex items-center gap-3 text-xs">
                <div className="w-32 shrink-0 text-slate-600">{st.label}</div>
                <div className="h-6 min-w-0 flex-1 rounded bg-slate-100">
                  <div
                    className="flex h-6 items-center rounded bg-[#2a78d6] px-2 font-semibold text-white"
                    style={{ width: `${Math.max(pct, st.value ? 8 : 0)}%` }}
                  >
                    {st.value}
                  </div>
                </div>
                <div className="w-28 shrink-0 text-right text-slate-500">
                  {i > 0 && `${pct.toFixed(0)}%`}
                  {prev ? <span className="ml-1 text-slate-400">({((st.value / prev) * 100).toFixed(0)}% da etapa)</span> : null}
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
            <span>
              Perdidos: <b className="text-red-600">{data.perdidos}</b>
            </span>
            <span>
              Carros comprados no período (com estoque): <b className="text-slate-800">{compradosTotal}</b>
            </span>
            <span>
              Carros vendidos no período: <b className="text-emerald-600">{vendidos}</b>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function vehicleLabel(lead: Lead) {
  const parts = [lead.vehicleBrand, lead.vehicleModel, lead.vehicleYear].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return lead.vehicleInfo || "—";
}

function fmtCurrency(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function costs(l: Lead) {
  return (l.fineDebts ?? 0) + (l.ipvaDebt ?? 0) + (l.otherExpenses ?? 0) + (l.prepCost ?? 0);
}

function profit(l: Lead): number | null {
  if (l.purchasePrice == null || l.salePrice == null) return null;
  return l.salePrice - l.purchasePrice - costs(l);
}

function margin(l: Lead): number | null {
  const p = profit(l);
  if (p == null || !l.salePrice) return null;
  return (p / l.salePrice) * 100;
}

type MoneyField = "purchasePrice" | "salePrice" | "ipvaDebt" | "fineDebts" | "prepCost" | "otherExpenses";

// Aceita "12500", "12.500,50", "R$ 12.500" e "12500.5"; vazio limpa o campo.
function parseMoney(raw: string): number | null | undefined {
  const t = raw.replace(/R\$|\s/g, "");
  if (!t) return null;
  let n: number;
  if (t.includes(",")) n = Number(t.replace(/\./g, "").replace(",", "."));
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ""));
  else n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function MoneyCell({
  value,
  hidden,
  onSave,
}: {
  value: number | null;
  hidden: boolean;
  onSave: (v: number | null) => void;
}) {
  if (hidden) return <span className="text-slate-500">{value != null ? "R$ ••••" : "—"}</span>;
  return (
    <input
      key={value ?? "vazio"}
      defaultValue={value != null ? value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}
      onBlur={(e) => {
        const parsed = parseMoney(e.target.value);
        if (parsed === undefined) {
          e.target.value = value != null ? String(value) : "";
          return;
        }
        if (parsed !== value) onSave(parsed);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      inputMode="decimal"
      placeholder="0,00"
      className="w-28 rounded-md border border-slate-300 bg-transparent px-2 py-1 text-right text-xs text-slate-800 placeholder:text-slate-400"
    />
  );
}

function NamePicker({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  const isCustom = !!value && !TEAM_NAMES.includes(value);
  const [showCustom, setShowCustom] = useState(isCustom);

  if (showCustom) {
    return (
      <input
        defaultValue={value ?? ""}
        onBlur={(e) => onChange(e.target.value.trim())}
        placeholder="Nome"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") setShowCustom(false);
        }}
        className="w-32 rounded-md border border-slate-300 bg-transparent px-2 py-1 text-xs text-slate-800 placeholder:text-slate-500"
      />
    );
  }

  return (
    <select
      value={value && TEAM_NAMES.includes(value) ? value : ""}
      onChange={(e) => {
        if (e.target.value === "__outro__") {
          setShowCustom(true);
        } else {
          onChange(e.target.value);
        }
      }}
      className="w-32 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-800"
    >
      <option value="">—</option>
      {TEAM_NAMES.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
      <option value="__outro__">Outro (digitar)...</option>
    </select>
  );
}

function Ranking({ title, leads, field }: { title: string; leads: Lead[]; field: "purchasedBy" | "soldBy" }) {
  const { hidden } = useHideMoney();
  const stats = useMemo(() => {
    const byName: Record<string, { count: number; lucro: number }> = {};
    for (const l of leads) {
      const name = l[field];
      if (!name) continue;
      const p = l.resaleStatus === "VENDIDO" ? (profit(l) ?? 0) : 0;
      byName[name] ??= { count: 0, lucro: 0 };
      byName[name].count++;
      byName[name].lucro += p;
    }
    return Object.entries(byName)
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.lucro - a.lucro);
  }, [leads, field]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 text-xs font-semibold text-slate-500">{title}</div>
      {stats.length === 0 ? (
        <div className="text-xs text-slate-500">Nenhum dado ainda</div>
      ) : (
        <div className="space-y-1.5">
          {stats.map((s, i) => (
            <div key={s.name} className="flex items-center justify-between text-xs">
              <span className="text-slate-600">
                {i === 0 && "🥇 "}
                {i === 1 && "🥈 "}
                {i === 2 && "🥉 "}
                {s.name}
              </span>
              <span className="text-slate-500">
                {s.count} negócio(s) · <span className={s.lucro >= 0 ? "text-emerald-600" : "text-red-600"}>{maskCurrency(hidden, fmtCurrency(s.lucro))}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Profitability() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("lucro");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("mes");
  const [offset, setOffset] = useState(0);
  const period = useMemo(() => periodRange(periodMode, offset), [periodMode, offset]);
  const inPeriod = (d: string | null) => {
    if (periodMode === "tudo") return true;
    if (!d) return false;
    const t = new Date(d).getTime();
    return t >= period.from.getTime() && t < period.to.getTime();
  };
  const soldInPeriod = (l: Lead) => l.resaleStatus === "VENDIDO" && inPeriod(l.soldAt);
  // No período aparecem os carros vendidos nele e os comprados nele.
  const periodLeads = periodMode === "tudo" ? leads : leads.filter((l) => soldInPeriod(l) || inPeriod(l.closedAt));
  const { hidden } = useHideMoney();

  useEffect(() => {
    const load = () =>
      api.get("/leads").then((res) => {
        setLeads(res.data.filter((l: Lead) => l.purchasePrice != null || l.salePrice != null));
        setLoading(false);
      });
    load();
    // Lançamentos feitos no Histórico chegam aqui na hora.
    socket.on("lead:updated", load);
    socket.on("lead:created", load);
    socket.on("lead:deleted", load);
    return () => {
      socket.off("lead:updated", load);
      socket.off("lead:created", load);
      socket.off("lead:deleted", load);
    };
  }, []);

  async function updateField(leadId: string, field: string, value: string) {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, [field]: value || null } : l)));
    await api.patch(`/leads/${leadId}`, { [field]: value || null });
  }

  async function updateMoney(leadId: string, field: MoneyField, value: number | null) {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, [field]: value } : l)));
    try {
      await api.patch(`/leads/${leadId}`, { [field]: value });
    } catch {
      alert("Não consegui salvar o valor. Tente de novo.");
    }
  }

  const sorted = useMemo(() => {
    const result = [...periodLeads];
    if (sortMode === "lucro") {
      result.sort((a, b) => (profit(b) ?? -Infinity) - (profit(a) ?? -Infinity));
    } else if (sortMode === "margem") {
      result.sort((a, b) => (margin(b) ?? -Infinity) - (margin(a) ?? -Infinity));
    } else {
      result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, sortMode, periodMode, offset]);

  // Os totais contam só carros vendidos; os demais seguem na tabela com o lucro previsto.
  const withProfit = leads
    .filter(soldInPeriod)
    .map(profit)
    .filter((p): p is number => p != null);
  const lucroTotal = withProfit.reduce((a, b) => a + b, 0);
  const lucroMedio = withProfit.length > 0 ? lucroTotal / withProfit.length : 0;
  const melhores = withProfit.filter((p) => p > 0).length;
  const piores = withProfit.filter((p) => p < 0).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-900">Rentabilidade</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-slate-300 text-sm">
            {(["semana", "mes", "tudo"] as PeriodMode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setPeriodMode(m);
                  setOffset(0);
                }}
                className={`px-3 py-1.5 ${periodMode === m ? "bg-[#0b2545] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {m === "semana" ? "Semana" : m === "mes" ? "Mês" : "Tudo"}
              </button>
            ))}
          </div>
          {periodMode !== "tudo" && (
            <div className="flex items-center gap-1 text-sm">
              <button onClick={() => setOffset((o) => o - 1)} className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50" aria-label="Período anterior">
                ‹
              </button>
              <span className="min-w-36 text-center font-medium text-slate-700">{period.label}</span>
              <button
                onClick={() => setOffset((o) => o + 1)}
                disabled={offset >= 0}
                className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Próximo período"
              >
                ›
              </button>
            </div>
          )}
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="lucro">Maior lucro</option>
            <option value="margem">Maior margem</option>
            <option value="recentes">Mais recentes</option>
          </select>
        </div>
      </div>

      <Funnel
        from={period.from}
        to={period.to}
        vendidos={leads.filter(soldInPeriod).length}
        compradosTotal={leads.filter((l) => (l.status === "FECHADO" || l.status === "GANHO") && inPeriod(l.closedAt)).length}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">
            Lucro {periodMode === "semana" ? "na semana" : periodMode === "mes" ? "no mês" : "total"}
          </div>
          <div className={`mt-1 text-2xl font-bold ${lucroTotal >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {maskCurrency(hidden, fmtCurrency(lucroTotal))}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Lucro médio por negócio</div>
          <div className={`mt-1 text-2xl font-bold ${lucroMedio >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {withProfit.length > 0 ? maskCurrency(hidden, fmtCurrency(lucroMedio)) : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Negócios com lucro</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">{melhores}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Negócios com prejuízo</div>
          <div className="mt-1 text-2xl font-bold text-red-600">{piores}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Ranking title="🏆 Ranking — prospecção de compra" leads={periodLeads} field="purchasedBy" />
        <Ranking title="🏆 Ranking — vendas" leads={periodLeads} field="soldBy" />
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Carregando...</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Lead</th>
                <th className="px-4 py-2">Veículo</th>
                <th className="px-4 py-2">Comprador</th>
                <th className="px-4 py-2">Prospectou</th>
                <th className="px-4 py-2">Vendeu</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Compra</th>
                <th className="px-4 py-2 text-right">Venda</th>
                <th className="px-4 py-2 text-right">IPVA</th>
                <th className="px-4 py-2 text-right">Multas</th>
                <th className="px-4 py-2 text-right">Preparo</th>
                <th className="px-4 py-2 text-right">Outras</th>
                <th className="px-4 py-2 text-right">Total custos</th>
                <th className="px-4 py-2 text-right">Lucro</th>
                <th className="px-4 py-2 text-right">Margem</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => {
                const p = profit(l);
                const m = margin(l);
                return (
                  <tr key={l.id} className="border-t border-slate-200">
                    <td className="px-4 py-2">
                      <Link to={`/leads/${l.id}`} className="text-slate-900 hover:underline">
                        {l.name || "Sem nome"}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-500">{vehicleLabel(l)}</td>
                    <td className="px-4 py-2">
                      <input
                        defaultValue={l.buyerName ?? ""}
                        onBlur={(e) => updateField(l.id, "buyerName", e.target.value.trim())}
                        placeholder="Nome do comprador"
                        className="w-36 rounded-md border border-slate-300 bg-transparent px-2 py-1 text-xs text-slate-800 placeholder:text-slate-500"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <NamePicker value={l.purchasedBy} onChange={(v) => updateField(l.id, "purchasedBy", v)} />
                    </td>
                    <td className="px-4 py-2">
                      <NamePicker value={l.soldBy} onChange={(v) => updateField(l.id, "soldBy", v)} />
                    </td>
                    <td className="px-4 py-2 text-slate-500">{STATUS_LABELS[l.status]}</td>
                    {(["purchasePrice", "salePrice", "ipvaDebt", "fineDebts", "prepCost", "otherExpenses"] as MoneyField[]).map((f) => (
                      <td key={f} className="px-2 py-2 text-right">
                        <MoneyCell value={l[f]} hidden={hidden} onSave={(v) => updateMoney(l.id, f, v)} />
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right text-slate-500">{costs(l) > 0 ? maskCurrency(hidden, fmtCurrency(costs(l))) : "—"}</td>
                    <td
                      className={`px-4 py-2 text-right font-medium ${
                        p == null ? "text-slate-500" : p >= 0 ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {p != null ? maskCurrency(hidden, fmtCurrency(p)) : "—"}
                    </td>
                    <td className={`px-4 py-2 text-right ${m == null ? "text-slate-500" : m >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {m != null ? (hidden ? "••%" : `${m.toFixed(1)}%`) : "—"}
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-4 py-6 text-center text-slate-500">
                    Nenhum carro comprado ou vendido neste período
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
