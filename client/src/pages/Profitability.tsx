import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Lead, STATUS_LABELS, TEAM_NAMES } from "../lib/types";
import { maskCurrency, useHideMoney } from "../lib/useHideMoney";

type SortMode = "lucro" | "recentes" | "margem";

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
      const p = profit(l) ?? 0;
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
  const { hidden } = useHideMoney();

  useEffect(() => {
    api.get("/leads").then((res) => {
      setLeads(res.data.filter((l: Lead) => l.purchasePrice != null || l.salePrice != null));
      setLoading(false);
    });
  }, []);

  async function updateField(leadId: string, field: string, value: string) {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, [field]: value || null } : l)));
    await api.patch(`/leads/${leadId}`, { [field]: value || null });
  }

  const sorted = useMemo(() => {
    const result = [...leads];
    if (sortMode === "lucro") {
      result.sort((a, b) => (profit(b) ?? -Infinity) - (profit(a) ?? -Infinity));
    } else if (sortMode === "margem") {
      result.sort((a, b) => (margin(b) ?? -Infinity) - (margin(a) ?? -Infinity));
    } else {
      result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return result;
  }, [leads, sortMode]);

  const withProfit = leads.map(profit).filter((p): p is number => p != null);
  const lucroTotal = withProfit.reduce((a, b) => a + b, 0);
  const lucroMedio = withProfit.length > 0 ? lucroTotal / withProfit.length : 0;
  const melhores = withProfit.filter((p) => p > 0).length;
  const piores = withProfit.filter((p) => p < 0).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-900">Rentabilidade</h1>
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Lucro total</div>
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
        <Ranking title="🏆 Ranking — prospecção de compra" leads={leads} field="purchasedBy" />
        <Ranking title="🏆 Ranking — vendas" leads={leads} field="soldBy" />
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
                <th className="px-4 py-2 text-right">Custos</th>
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
                    <td className="px-4 py-2 text-right text-slate-600">
                      {l.purchasePrice != null ? maskCurrency(hidden, fmtCurrency(l.purchasePrice)) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">
                      {l.salePrice != null ? maskCurrency(hidden, fmtCurrency(l.salePrice)) : "—"}
                    </td>
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
                  <td colSpan={11} className="px-4 py-6 text-center text-slate-500">
                    Nenhum negócio com valor de compra ou venda preenchido ainda
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
