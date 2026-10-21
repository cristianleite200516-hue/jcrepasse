import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { leadPhoneLabel, leadTitle } from "../lib/leadDisplay";
import { LEAD_STATUSES, LeadStatus, STATUS_LABELS } from "../lib/types";
import { SoldLeads } from "./Parados";

// Limpeza do funil (admin). Mover parados pra Perdido é reversível; EXCLUIR é definitivo e só acontece
// quando a pessoa clica no botão vermelho. Sugestão: baixe o CSV na página Leads antes de excluir.

interface Summary {
  days: number;
  byStatus: Record<string, number>;
  lostCount: number;
  soldCount: number;
  archivable: {
    count: number;
    items: {
      lead: { id: string; name: string | null; phone: string; status: LeadStatus; vehicleInfo: string | null; vehicleBrand: string | null; vehicleModel: string | null; vehicleYear: string | null };
      daysStalled: number;
      lastMessage: string;
    }[];
  };
}

interface LostLead {
  id: string;
  name: string | null;
  phone: string;
  vehicleInfo: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  lossReason: string | null;
  updatedAt: string;
}

const PERIODS = [7, 15, 30, 60, 90];

function Card({ title, hint, children, tone = "slate" }: { title: string; hint: string; children: React.ReactNode; tone?: "slate" | "red" }) {
  return (
    <section className={`rounded-lg border bg-white p-4 ${tone === "red" ? "border-red-200" : "border-slate-200"}`}>
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      <p className="mb-3 text-xs text-slate-500">{hint}</p>
      {children}
    </section>
  );
}

function ArchiveStalled({ summary, onDays, onDone }: { summary: Summary; onDays: (d: number) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { count, items } = summary.archivable;

  async function apply() {
    if (!window.confirm(`Mover ${count} lead(s) parados há ${summary.days}+ dias para Perdido? Dá pra mover de volta depois.`)) return;
    setBusy(true);
    try {
      const res = await api.post("/cockpit/cleanup/archive-stalled", { days: summary.days });
      setResult(`${res.data.moved} lead(s) movidos para Perdido.`);
      onDone();
    } catch {
      setResult("Não foi possível mover os leads.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={`Parados sem resposta (${count})`}
      hint="Novo, Contatado ou Qualificado que sumiram depois da nossa última mensagem, sem visita marcada. Quem está em Proposta ou escreveu por último fica de fora. Reversível: só muda o status pra Perdido e desliga a IA."
    >
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-slate-600">Parados há</span>
        <select value={summary.days} onChange={(e) => onDays(Number(e.target.value))} className="rounded-md border border-slate-300 px-2 py-1">
          {PERIODS.map((d) => (
            <option key={d} value={d}>
              {d}+ dias
            </option>
          ))}
        </select>
        {count > 0 && (
          <button onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-sky-700 hover:underline">
            {open ? "Esconder lista" : "Ver lista"}
          </button>
        )}
      </div>
      {open && (
        <div className="mb-3 max-h-60 overflow-y-auto rounded-md border border-slate-200 text-xs">
          {items.map((it) => (
            <div key={it.lead.id} className="flex justify-between gap-2 border-b border-slate-100 px-2 py-1 last:border-0">
              <Link to={`/leads/${it.lead.id}`} className="truncate hover:underline">
                {leadTitle(it.lead) === "Sem nome" ? leadPhoneLabel(it.lead.phone) : leadTitle(it.lead)}
              </Link>
              <span className="shrink-0 text-slate-500">
                {STATUS_LABELS[it.lead.status]} · {it.daysStalled}d
              </span>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={apply}
        disabled={busy || count === 0}
        className="rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f5c] disabled:opacity-50"
      >
        {busy ? "Movendo..." : `Mover ${count} para Perdido`}
      </button>
      {result && <div className="mt-2 text-xs text-slate-600">{result}</div>}
    </Card>
  );
}

function LostLeads({ onDone }: { onDone: () => void }) {
  const [items, setItems] = useState<LostLead[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/cockpit/cleanup/lost")
      .then((res) => {
        setItems(res.data.items);
        // Começa sem nada marcado: o histórico de pós-venda/cobrança também fica em Perdido.
      })
      .catch(() => setItems([]));
  }, []);

  if (!items) return null;

  async function deleteSelected() {
    if (!window.confirm(`EXCLUIR ${selected.size} lead(s) perdido(s) com conversa, anexos e histórico? Isso não tem volta.`)) return;
    setBusy(true);
    const ids = [...selected];
    let ok = 0;
    for (const id of ids) {
      try {
        await api.delete(`/leads/${id}`);
        ok++;
      } catch {
        // continua; o resumo mostra quantos falharam
      }
      setProgress(`${ok} de ${ids.length} excluídos...`);
    }
    const gone = new Set(ids);
    setItems((prev) => (prev ?? []).filter((i) => !gone.has(i.id) || false));
    setSelected(new Set());
    setProgress(`${ok} de ${ids.length} lead(s) excluído(s).`);
    setBusy(false);
    onDone();
  }

  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <Card
      tone="red"
      title={`Leads perdidos (${items.length})`}
      hint="Excluir apaga o lead, a conversa, os anexos e o histórico — não tem volta. Marque só quem quer excluir, ou use Selecionar todos e desmarque quem quiser manter."
    >
      {items.length === 0 ? (
        <div className="text-xs text-slate-500">Nenhum lead perdido. 🎉</div>
      ) : (
        <>
          <label className="mb-2 flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
            />
            Selecionar todos
          </label>
          <div className="mb-3 max-h-72 overflow-y-auto rounded-md border border-slate-200">
            {items.map((it) => (
              <label key={it.id} className="flex cursor-pointer items-start gap-2 border-b border-slate-100 px-2 py-1 text-xs last:border-0">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.has(it.id)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(it.id);
                      else next.delete(it.id);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-slate-900">
                    {leadTitle(it) === "Sem nome" ? leadPhoneLabel(it.phone) : leadTitle(it)}
                  </span>
                  {it.lossReason && <span className="block truncate text-slate-500">{it.lossReason}</span>}
                </span>
              </label>
            ))}
          </div>
          <button
            onClick={deleteSelected}
            disabled={busy || selected.size === 0}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Excluindo..." : `Excluir ${selected.size} selecionado(s)`}
          </button>
        </>
      )}
      {progress && <div className="mt-2 text-xs text-slate-600">{progress}</div>}
    </Card>
  );
}

export function Limpeza() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api
      .get("/cockpit/cleanup/summary", { params: { days } })
      .then((res) => setSummary(res.data))
      .catch(() => setError("Não foi possível carregar o resumo do funil."));
  }, [days, version]);

  const refresh = () => setVersion((v) => v + 1);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-lg font-bold text-slate-900">Limpeza do funil</h1>
      <p className="text-xs text-slate-500">
        Faça na ordem: 1) mova os parados pra Perdido (reversível), 2) exclua os que disseram que já venderam, 3) exclua os perdidos.
        Antes de excluir, baixe o CSV na página <Link to="/" className="font-medium text-sky-700 hover:underline">Leads</Link> como backup.
      </p>
      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {!summary && !error && <div className="text-sm text-slate-500">Carregando...</div>}
      {summary && (
        <>
          <Card title="Seu funil agora" hint="Quantos leads há em cada etapa.">
            <div className="flex flex-wrap gap-2 text-xs">
              {LEAD_STATUSES.map((s) => (
                <span key={s} className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                  {STATUS_LABELS[s]}: <strong>{summary.byStatus[s] ?? 0}</strong>
                </span>
              ))}
            </div>
          </Card>
          <ArchiveStalled summary={summary} onDays={setDays} onDone={refresh} />
          <SoldLeads />
          <LostLeads key={version} onDone={refresh} />
        </>
      )}
    </div>
  );
}
