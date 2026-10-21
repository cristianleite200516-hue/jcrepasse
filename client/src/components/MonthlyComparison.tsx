import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { BarChart } from "./charts/BarChart";
import { downloadCsv } from "../lib/csv";
import { maskCurrency, useHideMoney } from "../lib/useHideMoney";

interface MonthlyRow {
  month: string; // "2026-03"
  leads: number;
  agendamentos: number;
  visitas: number;
  fechamentos: number;
  faturamento: number;
}

const MONTH_NAMES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

function labelFor(month: string) {
  const [year, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]}/${year}`;
}

function fmtCurrency(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function MonthlyComparison() {
  const [rows, setRows] = useState<MonthlyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const { hidden } = useHideMoney();

  useEffect(() => {
    api.get("/dashboard/monthly", { params: { months: 12 } }).then((res) => {
      setRows(res.data);
      if (res.data.length > 0) {
        setFromMonth(res.data[0].month);
        setToMonth(res.data[res.data.length - 1].month);
      }
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(
    () => rows.filter((r) => (!fromMonth || r.month >= fromMonth) && (!toMonth || r.month <= toMonth)),
    [rows, fromMonth, toMonth]
  );

  if (loading) return <div className="text-sm text-slate-500">Carregando comparativo...</div>;

  function handleExport() {
    downloadCsv(
      `comparativo-mensal-${new Date().toISOString().slice(0, 10)}.csv`,
      filtered.map((r) => ({
        Mes: labelFor(r.month),
        Leads: r.leads,
        Agendamentos: r.agendamentos,
        Visitas: r.visitas,
        Fechamentos: r.fechamentos,
        Faturamento: r.faturamento,
      }))
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-600">Comparativo mês a mês</span>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button
            onClick={handleExport}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-100"
          >
            Exportar CSV
          </button>
          <span>De</span>
          <select
            value={fromMonth}
            onChange={(e) => setFromMonth(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            {rows.map((r) => (
              <option key={r.month} value={r.month}>
                {labelFor(r.month)}
              </option>
            ))}
          </select>
          <span>até</span>
          <select
            value={toMonth}
            onChange={(e) => setToMonth(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            {rows.map((r) => (
              <option key={r.month} value={r.month}>
                {labelFor(r.month)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">Leads por mês</div>
          <BarChart
            data={filtered.map((r) => ({ label: labelFor(r.month).split("/")[0], value: r.leads }))}
            color="#2a78d6"
          />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">Faturamento por mês</div>
          {hidden ? (
            <div className="flex h-[180px] items-center justify-center text-sm text-slate-500">Valores ocultos</div>
          ) : (
            <BarChart
              data={filtered.map((r) => ({ label: labelFor(r.month).split("/")[0], value: r.faturamento }))}
              color="#1baf7a"
              formatValue={fmtCurrency}
            />
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1.5">Mês</th>
              <th className="px-2 py-1.5">Leads</th>
              <th className="px-2 py-1.5">Agendamentos</th>
              <th className="px-2 py-1.5">Visitas</th>
              <th className="px-2 py-1.5">Fechamentos</th>
              <th className="px-2 py-1.5">Faturamento</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.month} className="border-t border-slate-200">
                <td className="px-2 py-1.5 font-medium text-slate-800">{labelFor(r.month)}</td>
                <td className="px-2 py-1.5">{r.leads}</td>
                <td className="px-2 py-1.5">{r.agendamentos}</td>
                <td className="px-2 py-1.5">{r.visitas}</td>
                <td className="px-2 py-1.5">{r.fechamentos}</td>
                <td className="px-2 py-1.5 font-medium text-emerald-600">{maskCurrency(hidden, fmtCurrency(r.faturamento))}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-slate-500">
                  Nenhum dado no período selecionado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
