import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { LEAD_STATUSES, STATUS_LABELS, LeadStatus } from "../lib/types";
import { leadPhoneLabel, leadTitle } from "../lib/leadDisplay";
import { StatusBadge } from "../components/StatusBadge";
import { socket } from "../lib/socket";

interface RecentCampaign {
  content: string;
  sentCount: number;
  firstAt: string;
  lastAt: string;
}

interface CampaignResponder {
  leadId: string;
  name: string | null;
  phone: string;
  status: LeadStatus;
  vehicleInfo: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  repliedAt: string;
  firstReply: string;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Separa quem recebeu uma campanha e respondeu depois, e move essas pessoas no funil de uma vez.
function CampaignResults({ refreshKey }: { refreshKey: number }) {
  const [campaigns, setCampaigns] = useState<RecentCampaign[] | null>(null);
  const [selectedContent, setSelectedContent] = useState("");
  const [data, setData] = useState<{ sentCount: number; responders: CampaignResponder[] } | null>(null);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [toStatus, setToStatus] = useState<LeadStatus>("QUALIFICADO");
  const [moving, setMoving] = useState(false);
  const [moveResult, setMoveResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/whatsapp/campaigns/recent")
      .then((res) => {
        setCampaigns(res.data);
        setSelectedContent((prev) => prev || res.data[0]?.content || "");
      })
      .catch(() => setError("Falha ao carregar as campanhas recentes"));
  }, [refreshKey]);

  async function loadResponses(content: string) {
    if (!content) return;
    setLoadingResponses(true);
    setError(null);
    try {
      const res = await api.post("/whatsapp/campaigns/responses", { content });
      setData(res.data);
    } catch {
      setError("Falha ao buscar as respostas da campanha");
    } finally {
      setLoadingResponses(false);
    }
  }

  useEffect(() => {
    setData(null);
    setMoveResult(null);
    loadResponses(selectedContent);
  }, [selectedContent]);

  const PROTECTED: LeadStatus[] = ["PROPOSTA", "GANHO", "FECHADO"];
  const movable = data?.responders.filter((r) => r.status !== toStatus && !PROTECTED.includes(r.status)) ?? [];

  async function moveResponders() {
    if (!confirm(`Mover ${movable.length} lead(s) que responderam para "${STATUS_LABELS[toStatus]}"?`)) return;
    setMoving(true);
    setError(null);
    try {
      const res = await api.post("/whatsapp/campaigns/move-responders", { content: selectedContent, toStatus });
      const { moved, alreadyInStatus, skippedAdvanced } = res.data;
      setMoveResult(
        `${moved} lead(s) movidos para ${STATUS_LABELS[toStatus]}.` +
          (alreadyInStatus ? ` ${alreadyInStatus} já estavam lá.` : "") +
          (skippedAdvanced ? ` ${skippedAdvanced} já estavam mais à frente (Proposta/Ganho/Fechado) e não foram mexidos.` : "")
      );
      await loadResponses(selectedContent);
    } catch {
      setError("Falha ao mover os leads");
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h2 className="font-semibold text-slate-900">Resultado das campanhas</h2>
        <p className="text-sm text-slate-500">Veja quem respondeu a uma campanha e mova essas pessoas no funil.</p>
      </div>

      {campaigns === null && !error && <div className="text-sm text-slate-500">Carregando campanhas...</div>}
      {campaigns?.length === 0 && (
        <div className="text-sm text-slate-500">Nenhuma campanha enviada nos últimos 30 dias.</div>
      )}

      {campaigns && campaigns.length > 0 && (
        <select
          value={selectedContent}
          onChange={(e) => setSelectedContent(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
        >
          {campaigns.map((c) => (
            <option key={c.content} value={c.content}>
              {fmtDateTime(c.lastAt)} · {c.sentCount} envios · {c.content.slice(0, 70)}
              {c.content.length > 70 ? "…" : ""}
            </option>
          ))}
        </select>
      )}

      {loadingResponses && <div className="text-sm text-slate-500">Buscando respostas...</div>}

      {data && !loadingResponses && (
        <>
          <div className="text-sm text-slate-700">
            <strong>{data.responders.length}</strong> de {data.sentCount} leads responderam
            {data.sentCount > 0 && ` (${Math.round((data.responders.length / data.sentCount) * 100)}%)`}.
          </div>

          {data.responders.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-600">Mover quem respondeu para</span>
                <select
                  value={toStatus}
                  onChange={(e) => {
                    setToStatus(e.target.value as LeadStatus);
                    setMoveResult(null);
                  }}
                  className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-sm text-slate-900"
                >
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                <button
                  onClick={moveResponders}
                  disabled={moving || movable.length === 0}
                  className="rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f5c] disabled:opacity-50"
                >
                  {moving ? "Movendo..." : `Mover ${movable.length} lead(s)`}
                </button>
              </div>

              <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
                {data.responders.map((r) => (
                  <Link
                    key={r.leadId}
                    to={`/leads/${r.leadId}`}
                    className="flex items-start justify-between gap-3 px-3 py-2 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {leadTitle(r) === "Sem nome" ? leadPhoneLabel(r.phone) : leadTitle(r)}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {fmtDateTime(r.repliedAt)} · {r.firstReply}
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {moveResult && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {moveResult}
        </div>
      )}
      {error && <div className="text-sm text-red-600">{error}</div>}
    </div>
  );
}

interface CampaignFilters {
  status?: LeadStatus;
  vehicleBrand?: string;
  minScore?: number;
  maxScore?: number;
  awaitingEngagementHours?: number;
}

export function Campaigns() {
  const [status, setStatus] = useState<LeadStatus | "">("");
  const [vehicleBrand, setVehicleBrand] = useState("");
  const [minScore, setMinScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [awaitingEngagementHours, setAwaitingEngagementHours] = useState("");
  const [toStatus, setToStatus] = useState<LeadStatus | "">("");
  const [message, setMessage] = useState("");

  const [count, setCount] = useState<number | null>(null);
  const [checkingCount, setCheckingCount] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number; stoppedEarly?: boolean; quotaReached?: boolean } | null>(null);
  const [limits, setLimits] = useState<{ dailyLimit: number; remainingToday: number; minDelayS: number; maxDelayS: number } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  function loadLimits() {
    api.get("/whatsapp/broadcast-limits").then((res) => setLimits(res.data)).catch(() => {});
  }

  useEffect(() => {
    loadLimits();
    function onProgress(p: { done: number; total: number }) {
      setProgress(p);
    }
    function onDone(summary: { sent: number; failed: number; stoppedEarly?: boolean; quotaReached?: boolean; error?: string }) {
      setSending(false);
      setProgress(null);
      if (summary.error) setError(summary.error);
      else setResult(summary);
      setResultsRefreshKey((k) => k + 1);
      loadLimits();
    }
    socket.on("broadcast:progress", onProgress);
    socket.on("broadcast:done", onDone);
    return () => {
      socket.off("broadcast:progress", onProgress);
      socket.off("broadcast:done", onDone);
    };
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [resultsRefreshKey, setResultsRefreshKey] = useState(0);

  function buildFilters(): CampaignFilters {
    const filters: CampaignFilters = {};
    if (status) filters.status = status;
    if (vehicleBrand.trim()) filters.vehicleBrand = vehicleBrand.trim();
    if (minScore) filters.minScore = Number(minScore);
    if (maxScore) filters.maxScore = Number(maxScore);
    if (awaitingEngagementHours) filters.awaitingEngagementHours = Number(awaitingEngagementHours);
    return filters;
  }

  async function checkCount() {
    setCheckingCount(true);
    setError(null);
    try {
      const res = await api.post("/whatsapp/broadcast-preview", buildFilters());
      setCount(res.data.count);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Falha ao calcular público");
    } finally {
      setCheckingCount(false);
    }
  }

  async function send() {
    if (!message.trim()) {
      setError("Escreva a mensagem antes de disparar.");
      return;
    }
    if (
      !confirm(
        `Confirma o disparo dessa mensagem para ${count ?? "?"} leads? Isso vai enviar mensagens reais pelo WhatsApp, aos poucos (25 a 75 s entre cada uma, até o limite de hoje).`
      )
    )
      return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      // O disparo roda em segundo plano; o andamento e o resultado chegam pelo socket.
      await api.post("/whatsapp/broadcast", {
        filters: buildFilters(),
        message: message.trim(),
        toStatus: toStatus || undefined,
      });
    } catch (err: any) {
      setError(err?.response?.data?.error || "Falha ao disparar mensagem");
      setSending(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Campanhas</h1>
        <p className="text-sm text-slate-500">
          Envie uma mensagem fixa por WhatsApp para um grupo de leads, filtrando por status, marca do veículo,
          score ou tempo sem engajar.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Status do lead</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as LeadStatus | "");
                setCount(null);
              }}
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
            >
              <option value="">Qualquer status</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Marca do veículo</label>
            <input
              value={vehicleBrand}
              onChange={(e) => {
                setVehicleBrand(e.target.value);
                setCount(null);
              }}
              placeholder="Ex: Fiat"
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Score mínimo</label>
            <input
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={(e) => {
                setMinScore(e.target.value);
                setCount(null);
              }}
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Score máximo</label>
            <input
              type="number"
              min={0}
              max={100}
              value={maxScore}
              onChange={(e) => {
                setMaxScore(e.target.value);
                setCount(null);
              }}
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
            />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
              Sem engajar há quantas horas (opcional)
            </label>
            <input
              type="number"
              min={1}
              max={720}
              value={awaitingEngagementHours}
              onChange={(e) => {
                setAwaitingEngagementHours(e.target.value);
                setCount(null);
              }}
              placeholder="Ex: 24 — só leads que a IA/agente respondeu e o cliente sumiu depois"
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
            Mover para status após enviar (opcional)
          </label>
          <select
            value={toStatus}
            onChange={(e) => setToStatus(e.target.value as LeadStatus | "")}
            className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
          >
            <option value="">Não mover</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Mensagem</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Escreva a mensagem que será enviada para todos os leads filtrados..."
            className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm text-slate-900"
          />
          <p className="mt-1 text-xs text-slate-500">
            Use <code>{"{nome}"}</code>, <code>{"{veiculo}"}</code> e <code>{"{valor}"}</code> pra personalizar cada mensagem. Sugestão
            de final: "Se não quiser mais receber, responda SAIR." (quem responder SAIR sai de todos os próximos disparos).
          </p>
        </div>

        {limits && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Hoje ainda cabem <strong>{limits.remainingToday}</strong> de {limits.dailyLimit} envios em lote. As mensagens saem com
            intervalo aleatório de {limits.minDelayS} a {limits.maxDelayS} segundos. Isso reduz, mas não elimina, o risco de o
            WhatsApp restringir o número. Quem pediu SAIR fica fora do público.
          </div>
        )}

        {error && <div className="text-sm text-red-600">{error}</div>}

        {progress && sending && (
          <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
            Enviando aos poucos: {progress.done} de {progress.total}. Pode sair desta página, o disparo continua.
          </div>
        )}
        {result && !result.stoppedEarly && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            Disparo concluído: {result.sent} enviados, {result.failed} falharam.
            {result.quotaReached && " O limite diário foi atingido; o restante do público fica pra outro dia."}
          </div>
        )}
        {result?.stoppedEarly && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Disparo interrompido: {result.sent} enviados, {result.failed} falharam seguidos e o restante do
            público não foi tentado. Isso costuma acontecer quando os leads filtrados não têm mais uma
            conversa válida no WhatsApp atual (ex: leads importados/restaurados de um backup) — confira se o
            filtro pegou algum grupo assim antes de tentar de novo.
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={checkCount}
            disabled={checkingCount}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50"
          >
            {checkingCount ? "Calculando..." : "Ver público"}
          </button>
          {count !== null && (
            <span className="text-sm text-slate-600">
              Esse filtro atinge <strong>{count}</strong> lead{count === 1 ? "" : "s"}.
            </span>
          )}
        </div>

        <button
          onClick={send}
          disabled={sending || !message.trim()}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {sending ? "Enviando..." : "Disparar mensagem"}
        </button>
      </div>

      <CampaignResults refreshKey={resultsRefreshKey} />
    </div>
  );
}
