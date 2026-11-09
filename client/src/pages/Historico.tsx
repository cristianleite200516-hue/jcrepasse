import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { maskCurrency, useHideMoney } from "../lib/useHideMoney";

interface Expense {
  id: string;
  date: string | null;
  description: string;
  amount: number;
}

interface Vehicle {
  id: string;
  plate: string | null;
  model: string;
  km: number | null;
  year: string | null;
  purchaseDate: string | null;
  saleDate: string | null;
  purchasePrice: number | null;
  salePrice: number | null;
  notes: string | null;
  expenses: Expense[];
}

type StatusFilter = "todos" | "estoque" | "vendidos";

const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");
const isoDay = (d: string | null) => (d ? d.slice(0, 10) : "");
const monthKey = (d: string | null) => (d ? d.slice(0, 7) : "sem-data");

function monthLabel(key: string) {
  if (key === "sem-data") return "Sem data";
  const [y, m] = key.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Aceita "12500", "12.500,50", "R$ 12.500" e "12500.5"; vazio = null; inválido = undefined.
function parseMoney(raw: string): number | null | undefined {
  const t = raw.replace(/R\$|\s/g, "");
  if (!t) return null;
  let n: number;
  if (t.includes(",")) n = Number(t.replace(/\./g, "").replace(",", "."));
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ""));
  else n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

const moneyInput = (v: number | null) =>
  v != null ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";

const spent = (v: Vehicle) => v.expenses.reduce((a, e) => a + e.amount, 0);
const invested = (v: Vehicle) => (v.purchasePrice ?? 0) + spent(v);
const isSold = (v: Vehicle) => v.saleDate != null || v.salePrice != null;
function profit(v: Vehicle): number | null {
  if (v.salePrice == null || v.purchasePrice == null) return null;
  return v.salePrice - invested(v);
}
// Mês em que o lucro entra: o da venda. Vendido sem data de venda cai no mês da compra.
const saleMonth = (v: Vehicle) => monthKey(v.saleDate ?? v.purchaseDate);
const currentMonth = () => new Date().toISOString().slice(0, 7);
// Salário = 10% do lucro dos carros vendidos no mês (mês com prejuízo não desconta nada).
const SALARY_RATE = 0.1;
const salary = (profit: number) => Math.max(0, profit) * SALARY_RATE;

interface MonthSummary {
  key: string;
  bought: number;
  paid: number;
  expenses: number;
  sold: number;
  revenue: number;
  profit: number;
}

function summarize(vehicles: Vehicle[], key: string): MonthSummary {
  const boughtList = vehicles.filter((v) => monthKey(v.purchaseDate) === key);
  const soldList = vehicles.filter((v) => isSold(v) && saleMonth(v) === key);
  return {
    key,
    bought: boughtList.length,
    paid: boughtList.reduce((a, v) => a + (v.purchasePrice ?? 0), 0),
    expenses: vehicles.reduce(
      (a, v) => a + v.expenses.filter((e) => monthKey(e.date ?? v.purchaseDate) === key).reduce((s, e) => s + e.amount, 0),
      0,
    ),
    sold: soldList.length,
    revenue: soldList.reduce((a, v) => a + (v.salePrice ?? 0), 0),
    profit: soldList.reduce((a, v) => a + (profit(v) ?? 0), 0),
  };
}

const inputCls = "w-full rounded border border-slate-300 px-2 py-1 text-sm";

// Confirmação dentro da tela: o confirm() do navegador é bloqueado em alguns navegadores
// embutidos (responde "não" sozinho) e aí nada era apagado.
function ConfirmButton({ label, ask, onConfirm, className }: { label: string; ask: string; onConfirm: () => void; className: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed)
    return (
      <button type="button" onClick={() => setArmed(true)} className={className} title={ask}>
        {label}
      </button>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-slate-600">{ask}</span>
      <button type="button" onClick={() => { setArmed(false); onConfirm(); }} className="rounded bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-700">
        Sim, apagar
      </button>
      <button type="button" onClick={() => setArmed(false)} className="rounded px-2 py-0.5 text-slate-600 hover:bg-slate-100">
        Não
      </button>
    </span>
  );
}

function NewVehicleForm({ onCreated }: { onCreated: (v: Vehicle) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ plate: "", model: "", year: "", km: "", purchaseDate: "", purchasePrice: "", notes: "" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const price = parseMoney(f.purchasePrice);
    if (price === undefined) return alert("Valor de compra inválido.");
    setSaving(true);
    try {
      const res = await api.post("/vehicles", {
        plate: f.plate || null,
        model: f.model,
        year: f.year || null,
        km: f.km ? Number(f.km.replace(/\D/g, "")) : null,
        purchaseDate: f.purchaseDate || null,
        purchasePrice: price,
        notes: f.notes || null,
      });
      onCreated(res.data);
      setF({ plate: "", model: "", year: "", km: "", purchaseDate: "", purchasePrice: "", notes: "" });
      setOpen(false);
    } catch {
      alert("Não consegui salvar o carro. Confira os campos e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600">
        + Novo carro
      </button>
    );

  const field = (key: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <label className="text-xs text-slate-500">
      {label}
      <input value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} className={inputCls} {...props} />
    </label>
  );

  return (
    <form onSubmit={submit} className="grid w-full grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4">
      {field("plate", "Placa")}
      {field("model", "Modelo *", { required: true })}
      {field("year", "Ano", { placeholder: "2016/2017" })}
      {field("km", "Km", { inputMode: "numeric" })}
      {field("purchaseDate", "Data da compra", { type: "date" })}
      {field("purchasePrice", "Valor pago", { inputMode: "decimal", placeholder: "R$" })}
      <div className="col-span-2">{field("notes", "Observação")}</div>
      <div className="col-span-2 flex gap-2 md:col-span-4">
        <button disabled={saving} className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
          Salvar
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
          Cancelar
        </button>
      </div>
    </form>
  );
}

function VehicleDetail({ v, hidden, onChange, onDelete }: { v: Vehicle; hidden: boolean; onChange: (v: Vehicle) => void; onDelete: () => void }) {
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  async function save(patch: Partial<Record<keyof Vehicle, unknown>>) {
    try {
      const res = await api.patch(`/vehicles/${v.id}`, patch);
      onChange(res.data);
    } catch {
      alert("Não consegui salvar. Tente de novo.");
    }
  }

  function saveMoney(key: "purchasePrice" | "salePrice", raw: string) {
    const n = parseMoney(raw);
    if (n === undefined || (n != null && n < 0)) return alert("Valor inválido.");
    if (n !== v[key]) save({ [key]: n });
  }

  async function addExpense(e: FormEvent) {
    e.preventDefault();
    const n = parseMoney(amount);
    if (n == null || n === undefined) return alert("Informe o valor do gasto.");
    try {
      const res = await api.post(`/vehicles/${v.id}/expenses`, { description: desc, amount: n, date: date || null });
      onChange(res.data);
      setDesc("");
      setAmount("");
    } catch {
      alert("Não consegui lançar o gasto. Tente de novo.");
    }
  }

  async function removeExpense(id: string) {
    try {
      const res = await api.delete(`/vehicles/${v.id}/expenses/${id}`);
      onChange(res.data);
    } catch {
      alert("Não consegui apagar o gasto. Tente de novo.");
    }
  }

  const text = (key: "plate" | "model" | "year" | "notes", label: string, wide = false) => (
    <label className={`text-xs text-slate-500 ${wide ? "col-span-2" : ""}`}>
      {label}
      <input
        key={`${key}-${v[key] ?? ""}`}
        defaultValue={v[key] ?? ""}
        onBlur={(e) => e.target.value !== (v[key] ?? "") && (key !== "model" || e.target.value.trim()) && save({ [key]: e.target.value || null })}
        className={inputCls}
      />
    </label>
  );
  const day = (key: "purchaseDate" | "saleDate", label: string) => (
    <label className="text-xs text-slate-500">
      {label}
      <input
        type="date"
        key={`${key}-${v[key] ?? ""}`}
        defaultValue={isoDay(v[key])}
        onBlur={(e) => e.target.value !== isoDay(v[key]) && save({ [key]: e.target.value || null })}
        className={inputCls}
      />
    </label>
  );
  const money = (key: "purchasePrice" | "salePrice", label: string) => (
    <label className="text-xs text-slate-500">
      {label}
      {hidden ? (
        <div className="py-1 text-sm text-slate-500">R$ ••••</div>
      ) : (
        <input key={`${key}-${v[key] ?? ""}`} defaultValue={moneyInput(v[key])} onBlur={(e) => saveMoney(key, e.target.value)} inputMode="decimal" className={inputCls} />
      )}
    </label>
  );

  const p = profit(v);
  return (
    <div className="space-y-4 bg-slate-50 p-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {text("plate", "Placa")}
        {text("model", "Modelo")}
        {text("year", "Ano")}
        <label className="text-xs text-slate-500">
          Km
          <input
            key={`km-${v.km ?? ""}`}
            defaultValue={v.km ?? ""}
            inputMode="numeric"
            onBlur={(e) => {
              const n = e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null;
              if (n !== v.km) save({ km: n });
            }}
            className={inputCls}
          />
        </label>
        {day("purchaseDate", "Data da compra")}
        {money("purchasePrice", "Valor pago")}
        {day("saleDate", "Data da venda")}
        {money("salePrice", "Valor de venda")}
        {text("notes", "Observação", true)}
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Gastos com o carro</div>
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
          {v.expenses.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">Nenhum gasto lançado.</div>}
          {v.expenses.map((e) => (
            <div key={e.id} className="flex items-center gap-3 border-b border-slate-100 px-3 py-1.5 text-sm last:border-0">
              <span className="w-20 shrink-0 text-slate-500">{fmtDate(e.date)}</span>
              <span className="flex-1">{e.description}</span>
              <span className="font-medium">{maskCurrency(hidden, fmt(e.amount))}</span>
              <ConfirmButton label="✕" ask="Apagar gasto?" onConfirm={() => removeExpense(e.id)} className="text-slate-400 hover:text-red-600" />
            </div>
          ))}
        </div>
        <form onSubmit={addExpense} className="mt-2 flex flex-wrap gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" />
          <input value={desc} onChange={(e) => setDesc(e.target.value)} required placeholder="O que foi gasto (ex: funilaria, pneu)" className="min-w-48 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="Valor" inputMode="decimal" className="w-28 rounded border border-slate-300 px-2 py-1 text-sm" />
          <button className="rounded-md bg-slate-800 px-3 py-1 text-sm font-medium text-white hover:bg-slate-900">Lançar gasto</button>
        </form>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex flex-wrap gap-4">
          <span>Pago: <b>{maskCurrency(hidden, fmt(v.purchasePrice ?? 0))}</b></span>
          <span>+ Gastos: <b>{maskCurrency(hidden, fmt(spent(v)))}</b></span>
          <span>= Total investido: <b>{maskCurrency(hidden, fmt(invested(v)))}</b></span>
          {p != null && (
            <span className={p >= 0 ? "text-emerald-700" : "text-red-600"}>
              Lucro: <b>{maskCurrency(hidden, fmt(p))}</b>
            </span>
          )}
        </div>
        <ConfirmButton label="Apagar carro" ask="Apagar o carro e todos os gastos? Não dá pra desfazer." onConfirm={onDelete} className="text-xs text-red-600 hover:underline" />
      </div>
    </div>
  );
}

export function Historico() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("todos");
  const [month, setMonth] = useState(currentMonth);
  const { hidden } = useHideMoney();

  useEffect(() => {
    api
      .get("/vehicles")
      .then((res) => setVehicles(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const months = useMemo(() => {
    const keys = new Set<string>([currentMonth()]);
    vehicles.forEach((v) => {
      keys.add(monthKey(v.purchaseDate));
      if (isSold(v)) keys.add(saleMonth(v));
    });
    return [...keys].sort().reverse();
  }, [vehicles]);

  const summaries = useMemo(() => months.map((m) => summarize(vehicles, m)), [vehicles, months]);

  // No mês escolhido aparecem os carros comprados OU vendidos nele.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter(
      (v) =>
        (status === "todos" || (status === "vendidos") === isSold(v)) &&
        (month === "todos" || monthKey(v.purchaseDate) === month || (isSold(v) && saleMonth(v) === month)) &&
        (!q || `${v.plate ?? ""} ${v.model} ${v.notes ?? ""}`.toLowerCase().includes(q)),
    );
  }, [vehicles, search, status, month]);

  const allTime: MonthSummary = summaries.reduce(
    (a, s) => ({
      key: "todos",
      bought: a.bought + s.bought,
      paid: a.paid + s.paid,
      expenses: a.expenses + s.expenses,
      sold: a.sold + s.sold,
      revenue: a.revenue + s.revenue,
      profit: a.profit + s.profit,
    }),
    { key: "todos", bought: 0, paid: 0, expenses: 0, sold: 0, revenue: 0, profit: 0 },
  );
  const sel = month === "todos" ? allTime : summaries.find((s) => s.key === month) ?? summarize(vehicles, month);
  const inStock = vehicles.filter((v) => !isSold(v));
  const stockValue = inStock.reduce((a, v) => a + invested(v), 0);
  const periodo = month === "todos" ? "(tudo)" : "no mês";

  function replace(v: Vehicle) {
    setVehicles((prev) => prev.map((x) => (x.id === v.id ? v : x)));
  }

  async function remove(v: Vehicle) {
    try {
      await api.delete(`/vehicles/${v.id}`);
      setVehicles((prev) => prev.filter((x) => x.id !== v.id));
      setOpenId(null);
    } catch {
      alert("Não consegui apagar. Tente de novo.");
    }
  }

  const card = (label: string, value: number, color = "text-slate-900", sub?: string) => (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color}`}>{maskCurrency(hidden, fmt(value))}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-slate-900">Histórico de Veículos</h1>
        <NewVehicleForm
          onCreated={(v) => {
            setVehicles((prev) => [v, ...prev]);
            setOpenId(v.id);
          }}
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {months.map((m) => (
          <button
            key={m}
            onClick={() => setMonth(m)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${month === m ? "bg-emerald-500 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"}`}
          >
            {monthLabel(m)}
          </button>
        ))}
        <button
          onClick={() => setMonth("todos")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${month === "todos" ? "bg-emerald-500 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"}`}
        >
          Todos
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {card(`Comprado ${periodo}`, sel.paid, "text-slate-900", `${sel.bought} carros`)}
        {card(`Gastos ${periodo}`, sel.expenses, "text-amber-600")}
        {card(`Vendido ${periodo}`, sel.revenue, "text-slate-900", `${sel.sold} vendidos`)}
        {card(`Lucro ${periodo}`, sel.profit, sel.profit >= 0 ? "text-emerald-600" : "text-red-600", "só carros vendidos")}
        {card(`Seu salário ${periodo}`, month === "todos" ? summaries.reduce((a, s) => a + salary(s.profit), 0) : salary(sel.profit), "text-violet-600", "10% do lucro")}
        {card("Parado em estoque hoje", stockValue, "text-slate-900", `${inStock.length} carros (pago + gastos)`)}
      </div>

      <div className="flex flex-wrap gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar placa ou modelo" className="min-w-48 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          <option value="todos">Todos</option>
          <option value="estoque">Em estoque</option>
          <option value="vendidos">Vendidos</option>
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Carregando…</div>
      ) : error ? (
        <div className="text-sm text-red-600">Não consegui carregar o histórico.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Placa</th>
                <th className="px-3 py-2">Modelo</th>
                <th className="px-3 py-2">Ano</th>
                <th className="px-3 py-2">Compra</th>
                <th className="px-3 py-2">Venda</th>
                <th className="px-3 py-2 text-right">Pago</th>
                <th className="px-3 py-2 text-right">Gastos</th>
                <th className="px-3 py-2 text-right">Vendido por</th>
                <th className="px-3 py-2 text-right">Lucro</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                    Nenhum carro encontrado.
                  </td>
                </tr>
              )}
              {filtered.map((v) => {
                const p = profit(v);
                const open = openId === v.id;
                const otherMonth = month !== "todos" && isSold(v) && saleMonth(v) !== month;
                return [
                  <tr key={v.id} onClick={() => setOpenId(open ? null : v.id)} className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${open ? "bg-slate-50" : ""}`}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{v.plate ?? "—"}</td>
                    <td className="px-3 py-2">
                      {v.model}
                      {v.notes && <div className="text-xs text-slate-400">{v.notes}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">{v.year ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{fmtDate(v.purchaseDate)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {isSold(v) ? fmtDate(v.saleDate) : <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-700">Em estoque</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{v.purchasePrice != null ? maskCurrency(hidden, fmt(v.purchasePrice)) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-amber-700">{v.expenses.length ? maskCurrency(hidden, fmt(spent(v))) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{v.salePrice != null ? maskCurrency(hidden, fmt(v.salePrice)) : "—"}</td>
                    <td
                      title={otherMonth ? `Lucro entra em ${monthLabel(saleMonth(v))}` : undefined}
                      className={`whitespace-nowrap px-3 py-2 text-right font-medium ${p == null || otherMonth ? "text-slate-400" : p >= 0 ? "text-emerald-600" : "text-red-600"}`}
                    >
                      {p != null ? maskCurrency(hidden, fmt(p)) : "—"}
                      {otherMonth && <div className="text-[10px] font-normal">entra em {monthLabel(saleMonth(v)).split(" ")[0].toLowerCase()}</div>}
                    </td>
                  </tr>,
                  open && (
                    <tr key={`${v.id}-detail`}>
                      <td colSpan={9} className="border-t border-slate-100 p-0">
                        <VehicleDetail v={v} hidden={hidden} onChange={replace} onDelete={() => remove(v)} />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Resumo por mês</div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Mês</th>
                  <th className="px-3 py-2 text-right">Compras</th>
                  <th className="px-3 py-2 text-right">Pago</th>
                  <th className="px-3 py-2 text-right">Gastos</th>
                  <th className="px-3 py-2 text-right">Vendas</th>
                  <th className="px-3 py-2 text-right">Vendido</th>
                  <th className="px-3 py-2 text-right">Lucro</th>
                  <th className="px-3 py-2 text-right">Salário (10%)</th>
                </tr>
              </thead>
              <tbody>
                {[...summaries, allTime].map((s) => (
                  <tr
                    key={s.key}
                    onClick={() => setMonth(s.key)}
                    className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${s.key === "todos" ? "font-semibold" : ""} ${month === s.key ? "bg-emerald-50" : ""}`}
                  >
                    <td className="px-3 py-2">{s.key === "todos" ? "Total" : monthLabel(s.key)}</td>
                    <td className="px-3 py-2 text-right">{s.bought}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{maskCurrency(hidden, fmt(s.paid))}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-amber-700">{maskCurrency(hidden, fmt(s.expenses))}</td>
                    <td className="px-3 py-2 text-right">{s.sold}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{maskCurrency(hidden, fmt(s.revenue))}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right ${s.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {maskCurrency(hidden, fmt(s.profit))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-violet-600">
                      {maskCurrency(hidden, fmt(s.key === "todos" ? summaries.reduce((a, m) => a + salary(m.profit), 0) : salary(s.profit)))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
