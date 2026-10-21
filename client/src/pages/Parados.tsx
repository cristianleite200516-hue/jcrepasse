import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { askingVsFipe, HOME_DDD, leadDdd, leadPhoneLabel, leadTitle } from "../lib/leadDisplay";
import { STATUS_LABELS, LeadStatus } from "../lib/types";

// Leads em aberto que pararam de conversar: organiza por quem falou por último e há quanto tempo,
// pra retomar um a um (abre a conversa) ou chamar em sequência. Não envia nada sozinha.

interface StalledItem {
  lead: {
    id: string;
    name: string | null;
    phone: string;
    phone2: string | null;
    areaCode: string | null;
    status: LeadStatus;
    vehicleInfo: string | null;
    vehicleBrand: string | null;
    vehicleModel: string | null;
    vehicleYear: string | null;
    askingPrice: string | null;
    fipeValue: string | null;
    urgency: string | null;
    score: number;
  };
  lastMessageAt: string;
  lastFrom: "LEAD" | "AI" | "AGENT";
  lastMessage: string;
  followUpAttempts: number;
  daysStalled: number;
}

const PERIODS = [
  { days: 3, label: "3+ dias" },
  { days: 7, label: "7+ dias" },
  { days: 15, label: "15+ dias" },
  { days: 30, label: "30+ dias" },
];

function Section({ title, hint, items }: { title: string; hint: string; items: StalledItem[] }) {
  const navigate = useNavigate();
  if (items.length === 0) return null;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">
        {title} <span className="text-slate-500">({items.length})</span>
      </h2>
      <p className="mb-3 text-xs text-slate-500">{hint}</p>
      <div className="divide-y divide-slate-100">
        {items.map((it) => {
          const diff = askingVsFipe(it.lead);
          const ddd = leadDdd(it.lead);
          return (
            <div key={it.lead.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/leads/${it.lead.id}`} className="truncate text-sm font-medium text-slate-900 hover:underline">
                    {leadTitle(it.lead) === "Sem nome" ? leadPhoneLabel(it.lead.phone) : leadTitle(it.lead)}
                  </Link>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                    {STATUS_LABELS[it.lead.status]}
                  </span>
                  {ddd && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        ddd === HOME_DDD ? "bg-emerald-500/15 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      DDD {ddd}
                    </span>
                  )}
                  {it.lead.askingPrice && (
                    <span className="text-xs font-medium text-emerald-600">
                      {it.lead.askingPrice}
                      {diff !== null && ` (${diff > 0 ? "+" : ""}${diff}% FIPE)`}
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {it.lastFrom === "LEAD" ? "Lead: " : it.lastFrom === "AI" ? "IA: " : "Equipe: "}
                  {it.lastMessage}
                </div>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div className="font-semibold text-slate-700">{it.daysStalled}d parado</div>
                {it.followUpAttempts > 0 && <div>{it.followUpAttempts} tentativa(s) da IA</div>}
              </div>
              <button
                onClick={() => navigate(`/inbox?lead=${it.lead.id}`)}
                className="rounded-md bg-[#0b2545] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#122f5c]"
              >
                Retomar
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface SoldItem {
  lead: { id: string; name: string | null; phone: string; status: LeadStatus; vehicleInfo: string | null; vehicleBrand: string | null; vehicleModel: string | null; vehicleYear: string | null };
  message: string;
  at: string;
}

// Só admin: leads que disseram que já venderam o veículo, todos marcados, com exclusão em lote.
export function SoldLeads() {
  const [items, setItems] = useState<SoldItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    api.get("/cockpit/sold-candidates").then((res) => {
      setItems(res.data.items);
      setSelected(new Set(res.data.items.map((i: SoldItem) => i.lead.id)));
    }).catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) return null;

  async function deleteSelected() {
    if (!window.confirm(`Excluir ${selected.size} lead(s) com conversa, anexos e histórico? Isso não tem volta.`)) return;
    setBusy(true);
    let ok = 0;
    for (const id of selected) {
      try {
        await api.delete(`/leads/${id}`);
        ok++;
      } catch {
        // segue pros próximos; o resumo mostra quantos falharam
      }
    }
    setItems((prev) => (prev ?? []).filter((i) => !selected.has(i.lead.id) || false));
    setResult(`${ok} de ${selected.size} lead(s) excluído(s).`);
    setSelected(new Set());
    setBusy(false);
  }

  return (
    <section className="rounded-lg border border-red-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">
        Disseram que já venderam o veículo <span className="text-slate-500">({items.length})</span>
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Confira a mensagem de cada um. Desmarque quem não deve ser excluído. Ganho e Fechado ficam de fora.
      </p>
      <div className="divide-y divide-slate-100">
        {items.map((it) => (
          <label key={it.lead.id} className="flex cursor-pointer items-start gap-3 py-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.has(it.lead.id)}
              onChange={(e) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(it.lead.id);
                  else next.delete(it.lead.id);
                  return next;
                })
              }
            />
            <span className="min-w-0 flex-1">
              <span className="text-sm font-medium text-slate-900">
                {leadTitle(it.lead) === "Sem nome" ? leadPhoneLabel(it.lead.phone) : leadTitle(it.lead)}
              </span>
              <span className="ml-2 text-[10px] font-semibold text-slate-500">{STATUS_LABELS[it.lead.status]}</span>
              <span className="block truncate text-xs text-slate-600">“{it.message}”</span>
            </span>
          </label>
        ))}
      </div>
      <button
        onClick={deleteSelected}
        disabled={busy || selected.size === 0}
        className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {busy ? "Excluindo..." : `Excluir selecionados (${selected.size})`}
      </button>
      {result && <div className="mt-2 text-xs text-slate-600">{result}</div>}
    </section>
  );
}

export function Parados() {
  const [days, setDays] = useState(3);
  const [data, setData] = useState<{ count: number; items: StalledItem[] } | null>(null);
  const [ddd, setDdd] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .get("/cockpit/stalled", { params: { days } })
      .then((res) => setData(res.data))
      .catch(() => setError("Não foi possível carregar os leads parados."));
  }, [days]);

  const items = useMemo(
    () => (data?.items ?? []).filter((it) => !ddd || (ddd === "none" ? !leadDdd(it.lead) : leadDdd(it.lead) === ddd)),
    [data, ddd]
  );

  const dddOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of data?.items ?? []) {
      const d = leadDdd(it.lead) ?? "none";
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => (a[0] === HOME_DDD ? -1 : b[0] === HOME_DDD ? 1 : b[1] - a[1]));
  }, [data]);

  const waitingUs = items.filter((it) => it.lastFrom === "LEAD");
  const withVehicle = (it: StalledItem) => !!(it.lead.vehicleBrand || it.lead.vehicleModel || it.lead.vehicleInfo);
  const ghosted = items.filter((it) => it.lastFrom !== "LEAD");
  const hot = ghosted.filter((it) => it.lead.status === "QUALIFICADO" || it.lead.status === "PROPOSTA");
  const rest = ghosted.filter((it) => !hot.includes(it));
  const restWithVehicle = rest.filter(withVehicle);
  const restNoVehicle = rest.filter((it) => !withVehicle(it));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-slate-900">Leads parados</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {PERIODS.map((p) => (
              <option key={p.days} value={p.days}>
                Parados há {p.label}
              </option>
            ))}
          </select>
          <select value={ddd} onChange={(e) => setDdd(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
            <option value="">Todos os DDDs</option>
            {dddOptions.map(([d, n]) => (
              <option key={d} value={d}>
                {d === "none" ? "DDD desconhecido" : `DDD ${d}`} ({n})
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Só leads em aberto (sem Perdido, Ganho ou Fechado) e sem visita marcada. Para perguntar "ainda tem o veículo à venda?" pra vários
        de uma vez, use <Link to="/campanhas" className="font-medium text-sky-700 hover:underline">Campanhas</Link> e acompanhe quem
        respondeu lá.
      </p>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {!data && !error && <div className="text-sm text-slate-500">Carregando...</div>}
      {data && items.length === 0 && (
        <div className="rounded-md bg-slate-50 py-6 text-center text-sm text-slate-500">Nenhum lead parado nesse filtro. 🎉</div>
      )}

      <Section
        title="Esperando resposta nossa"
        hint="O lead escreveu por último e ninguém respondeu. Resolva estes primeiro."
        items={waitingUs}
      />
      <Section
        title="Quentes que sumiram"
        hint="Qualificados ou com proposta, e nós falamos por último. Vale um contato pessoal."
        items={hot}
      />
      <Section
        title="Sumiram — com veículo informado"
        hint="Já disseram qual carro têm. Pergunte se ainda está à venda."
        items={restWithVehicle}
      />
      <Section
        title="Sumiram — sem veículo informado"
        hint="Nunca disseram o carro. Pode valer só um 'ainda quer vender?'."
        items={restNoVehicle}
      />
    </div>
  );
}
