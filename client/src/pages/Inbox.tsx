import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { ConversationSummary, isAiActiveNow, Lead, LEAD_STATUSES, LeadStatus, Message, STATUS_LABELS } from "../lib/types";
import { HOME_DDD, leadDdd, leadPhoneLabel, leadTitle } from "../lib/leadDisplay";
import { useAuth } from "../lib/auth";
import { ConversationPanel } from "../components/ConversationPanel";
import { StatusBadge } from "../components/StatusBadge";

const SENDER_PREFIX: Record<Message["sender"], string> = {
  LEAD: "",
  AI: "IA: ",
  AGENT: "Você: ",
};

function fmtLastMessageAt(iso: string) {
  const date = new Date(iso);
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function fmtWaiting(ms: number) {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)}d`;
}

// Sem nome nem carro ainda, o que identifica a conversa é o contato do WhatsApp.
function conversationTitle(c: ConversationSummary) {
  const title = leadTitle(c.lead);
  return title === "Sem nome" ? leadPhoneLabel(c.lead.phone) : title;
}

export function Inbox() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  // Links do painel do dia (Rotina): ?fila=1 abre direto na fila "Precisa de mim", ?lead=ID abre a conversa.
  const [searchParams] = useSearchParams();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(searchParams.get("lead"));
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  // O botão "Chamar leads" do funil abre aqui com ?status=&ddd=&seq=1, pra chamar um atrás do outro
  // sem voltar pro funil: a lista vira a fila e, depois de enviar, já abre o próximo.
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "">(
    (LEAD_STATUSES as readonly string[]).includes(searchParams.get("status") ?? "")
      ? (searchParams.get("status") as LeadStatus)
      : ""
  );
  const [needsMeOnly, setNeedsMeOnly] = useState(searchParams.get("fila") === "1");
  // "" = todos, "none" = DDD desconhecido, senão o DDD
  const [dddFilter, setDddFilter] = useState(searchParams.get("ddd") ?? "");
  const [homeFirst, setHomeFirst] = useState(searchParams.get("primeiro") !== "0");
  const [sequence, setSequence] = useState(searchParams.get("seq") === "1");
  // Relógio pro "esperando há..." da fila ir atualizando sem recarregar a página.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState<{ done: number; total: number } | null>(null);
  // Mesmo texto pra todos da fila "Precisa de mim" (envio em segundo plano no servidor).
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("bom dia tudo bem? seu veículo está disponível para venda? estamos comprando");
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  useEffect(() => {
    function onProgress(p: { done: number; total: number }) {
      setBulkProgress(p);
    }
    function onDone(r: { sent: number; failed: number; total: number; stoppedEarly: boolean }) {
      setBulkProgress(null);
      setBulkResult(
        `${r.sent} mensagem(ns) enviada(s)` +
          (r.failed ? `, ${r.failed} falha(s)` : "") +
          (r.stoppedEarly ? " — envio interrompido depois de várias falhas seguidas (confira o WhatsApp)." : ".")
      );
    }
    socket.on("bulk-message:progress", onProgress);
    socket.on("bulk-message:done", onDone);
    return () => {
      socket.off("bulk-message:progress", onProgress);
      socket.off("bulk-message:done", onDone);
    };
  }, []);

  async function load() {
    const res = await api.get("/conversations");
    setConversations(res.data);
    setLoading(false);
    const firstInQueue = needsMeOnly
      ? (res.data as ConversationSummary[])
          .filter(needsMe)
          .sort((a, b) => new Date(a.lastMessage!.createdAt).getTime() - new Date(b.lastMessage!.createdAt).getTime())[0]
      : sequence
        ? filterAndSort(res.data as ConversationSummary[])[0]
        : undefined;
    setSelectedLeadId((prev) => prev ?? firstInQueue?.leadId ?? res.data[0]?.leadId ?? null);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    function onMessage(payload: { leadId: string; message: Message }) {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.leadId === payload.leadId);
        if (idx === -1) {
          load();
          return prev;
        }
        const updated = { ...prev[idx], lastMessage: payload.message };
        const rest = prev.filter((_, i) => i !== idx);
        return [updated, ...rest];
      });
    }
    function onLeadCreated() {
      load();
    }
    function onConversationUpdated(conv: {
      id: string;
      leadId: string;
      aiEnabled?: boolean;
      unread?: boolean;
      aiPausedUntil?: string | null;
    }) {
      setConversations((prev) =>
        prev.map((c) =>
          c.leadId === conv.leadId
            ? {
                ...c,
                aiEnabled: conv.aiEnabled ?? c.aiEnabled,
                unread: conv.unread ?? c.unread,
                aiPausedUntil: "aiPausedUntil" in conv ? conv.aiPausedUntil : c.aiPausedUntil,
              }
            : c
        )
      );
    }
    socket.on("message:new", onMessage);
    socket.on("lead:created", onLeadCreated);
    socket.on("conversation:updated", onConversationUpdated);
    socket.on("whatsapp:import-complete", load);
    function onLeadDeleted(payload: { id: string }) {
      setConversations((prev) => prev.filter((c) => c.leadId !== payload.id));
      setSelectedLeadId((prev) => (prev === payload.id ? null : prev));
      setSelected((prev) => {
        if (!prev.has(payload.id)) return prev;
        const next = new Set(prev);
        next.delete(payload.id);
        return next;
      });
    }
    socket.on("lead:deleted", onLeadDeleted);
    // Status/nome/carro mudam pela IA ou pela equipe (ex: Novo → Contatado ao responder) — sem isso a
    // lista ficava mostrando a etapa antiga até recarregar a página.
    function onLeadUpdated(lead: Lead) {
      setConversations((prev) =>
        prev.map((c) =>
          c.leadId === lead.id
            ? {
                ...c,
                lead: {
                  ...c.lead,
                  name: lead.name,
                  phone: lead.phone,
                  status: lead.status,
                  vehicleBrand: lead.vehicleBrand,
                  vehicleModel: lead.vehicleModel,
                  vehicleYear: lead.vehicleYear,
                  vehicleInfo: lead.vehicleInfo,
                  ...{ phone2: lead.phone2, areaCode: (lead as { areaCode?: string | null }).areaCode },
                },
              }
            : c
        )
      );
    }
    socket.on("lead:updated", onLeadUpdated);
    return () => {
      socket.off("message:new", onMessage);
      socket.off("lead:created", onLeadCreated);
      socket.off("conversation:updated", onConversationUpdated);
      socket.off("whatsapp:import-complete", load);
      socket.off("lead:deleted", onLeadDeleted);
      socket.off("lead:updated", onLeadUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unreadCount = useMemo(() => conversations.filter((c) => c.unread).length, [conversations]);

  // "Precisa de mim" = o lead está esperando e a IA NÃO vai responder sozinha: IA desligada nessa
  // conversa, pausada porque a equipe estava nela, ou o lead espera há 10+ min (a IA falhou ou está
  // pausada no geral). Conversas que a IA vai responder ficam fora, pra fila ter só o que é seu.
  const NEEDS_ME_WAIT_MS = 10 * 60 * 1000;
  const needsMe = (c: ConversationSummary) => {
    if (c.lastMessage?.sender !== "LEAD" || c.lead.status === "PERDIDO") return false;
    return !isAiActiveNow(c) || now - new Date(c.lastMessage.createdAt).getTime() >= NEEDS_ME_WAIT_MS;
  };
  const needsMeCount = useMemo(() => conversations.filter(needsMe).length, [conversations, now]);

  function filterAndSort(all: ConversationSummary[]) {
    const q = query.trim().toLowerCase();
    const list = all.filter((c) => {
      if (statusFilter && c.lead.status !== statusFilter) return false;
      if (needsMeOnly && !needsMe(c)) return false;
      if (dddFilter && (leadDdd(c.lead) ?? "none") !== dddFilter) return false;
      if (!q) return true;
      return (
        leadTitle(c.lead).toLowerCase().includes(q) || c.lead.phone.toLowerCase().includes(q)
      );
    });
    // Na fila, quem espera há mais tempo vem primeiro.
    const sorted = needsMeOnly
      ? [...list].sort(
          (a, b) => new Date(a.lastMessage!.createdAt).getTime() - new Date(b.lastMessage!.createdAt).getTime()
        )
      : [...list];
    // sort estável: dentro de cada grupo mantém a ordem acima
    if (homeFirst) sorted.sort((a, b) => (leadDdd(a.lead) === HOME_DDD ? 0 : 1) - (leadDdd(b.lead) === HOME_DDD ? 0 : 1));
    return sorted;
  }

  const filtered = useMemo(
    () => filterAndSort(conversations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, query, statusFilter, needsMeOnly, now, dddFilter, homeFirst]
  );

  const dddOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of conversations) {
      const ddd = leadDdd(c.lead) ?? "none";
      counts.set(ddd, (counts.get(ddd) ?? 0) + 1);
    }
    const others = [...counts.keys()].filter((d) => d !== HOME_DDD && d !== "none").sort();
    return { counts, others };
  }, [conversations]);

  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  // Depois de responder alguém da fila (ou chamar em sequência), abre o próximo — sem precisar procurar.
  function openNextInQueue(currentLeadId: string) {
    if (!needsMeOnly && !sequence) return;
    const list = filteredRef.current;
    const idx = list.findIndex((c) => c.leadId === currentLeadId);
    const next = list.slice(idx + 1).find((c) => c.leadId !== currentLeadId) ?? list.find((c) => c.leadId !== currentLeadId);
    if (next) setSelectedLeadId(next.leadId);
  }

  function toggleNeedsMe() {
    const turningOn = !needsMeOnly;
    setNeedsMeOnly(turningOn);
    if (turningOn) {
      const first = conversations
        .filter(needsMe)
        .sort((a, b) => new Date(a.lastMessage!.createdAt).getTime() - new Date(b.lastMessage!.createdAt).getTime())[0];
      if (first) setSelectedLeadId(first.leadId);
    }
  }

  // Envio em massa pra lista filtrada: fila "Precisa de mim" e/ou um DDD (ex: "DDD desconhecido").
  const bulkListLabel = [
    needsMeOnly && 'fila "Precisa de mim"',
    dddFilter && (dddFilter === "none" ? "DDD desconhecido" : `DDD ${dddFilter}`),
  ]
    .filter(Boolean)
    .join(" + ");

  async function sendBulk() {
    const ids = filtered.map((c) => c.leadId);
    const text = bulkText.trim();
    if (ids.length === 0 || !text) return;
    if (
      !confirm(
        `Enviar esta mensagem pra ${ids.length} lead(s) (${bulkListLabel})?\n\n"${text}"\n\nVai uma por uma, com 4s de intervalo (~${Math.ceil((ids.length * 4) / 60)} min).`
      )
    )
      return;
    setBulkResult(null);
    try {
      const res = await api.post("/conversations/bulk-message", { leadIds: ids, content: text });
      setBulkProgress({ done: 0, total: res.data.queued });
      setBulkOpen(false);
    } catch (err: any) {
      setBulkResult(err?.response?.data?.error || "Não foi possível iniciar o envio.");
    }
  }

  function toggleSelected(leadId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }

  function exitSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.leadId));

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((c) => next.delete(c.leadId));
      else filtered.forEach((c) => next.add(c.leadId));
      return next;
    });
  }

  // Exclusão é definitiva (conversa, anexos com os arquivos das fotos, agendamentos, assinaturas) —
  // mesma confirmação digitada da exclusão individual, com a contagem e alguns nomes à vista.
  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const names = conversations
      .filter((c) => selected.has(c.leadId))
      .slice(0, 5)
      .map((c) => `• ${conversationTitle(c)}`)
      .join("\n");
    const more = ids.length > 5 ? `\n… e mais ${ids.length - 5}` : "";
    const confirmText = window.prompt(
      `Isso apaga ${ids.length} lead(s) e TODA a conversa, anexos e agendamentos deles — não tem como desfazer.\n\n${names}${more}\n\nPra confirmar, digite EXCLUIR:`
    );
    if (confirmText !== "EXCLUIR") return;

    setBulkDeleting({ done: 0, total: ids.length });
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      try {
        await api.delete(`/leads/${ids[i]}`);
      } catch {
        failed++;
      }
      setBulkDeleting({ done: i + 1, total: ids.length });
    }
    setBulkDeleting(null);
    if (failed > 0) {
      alert(`${ids.length - failed} lead(s) excluídos. ${failed} não puderam ser excluídos — tente de novo.`);
      load();
    } else {
      exitSelecting();
    }
  }

  return (
    <div className="grid grid-cols-3 gap-4 h-[80vh]">
      <div className="col-span-1 flex flex-col rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="space-y-2 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="font-semibold text-slate-900">
              Conversas
              {unreadCount > 0 && (
                <span className="ml-2 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </h1>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                {filtered.length}
                {filtered.length !== conversations.length ? ` de ${conversations.length}` : ""}
              </span>
              {isAdmin && (
                <button
                  onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
                  disabled={!!bulkDeleting}
                  className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                >
                  {selecting ? "Cancelar" : "Selecionar"}
                </button>
              )}
            </div>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou telefone..."
            className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as LeadStatus | "")}
            className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm"
          >
            <option value="">Todos os status</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            value={dddFilter}
            onChange={(e) => setDddFilter(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-sm"
          >
            <option value="">Todos os DDDs</option>
            <option value={HOME_DDD}>
              DDD {HOME_DDD} — minha região ({dddOptions.counts.get(HOME_DDD) ?? 0})
            </option>
            {dddOptions.others.map((d) => (
              <option key={d} value={d}>
                DDD {d} ({dddOptions.counts.get(d)})
              </option>
            ))}
            <option value="none">DDD desconhecido ({dddOptions.counts.get("none") ?? 0})</option>
          </select>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={homeFirst} onChange={(e) => setHomeFirst(e.target.checked)} />
              DDD {HOME_DDD} primeiro
            </label>
            <label
              className="flex items-center gap-1.5"
              title="Depois de enviar uma mensagem, abre sozinho o próximo lead desta lista"
            >
              <input type="checkbox" checked={sequence} onChange={(e) => setSequence(e.target.checked)} />
              Abrir o próximo ao enviar
            </label>
          </div>
          <button
            onClick={toggleNeedsMe}
            title="Só as conversas em que o lead está esperando e a IA não vai responder sozinha — mais antigas primeiro"
            className={`w-full rounded-md border px-2 py-1.5 text-sm font-medium ${
              needsMeOnly
                ? "border-amber-500 bg-amber-500/10 text-amber-700"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {needsMeOnly ? "✓ " : ""}Precisa de mim ({needsMeCount})
          </button>
          {isAdmin && bulkListLabel && filtered.length > 0 && !bulkProgress && (
            <button
              onClick={() => setBulkOpen((v) => !v)}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              ✉️ Mensagem pra todos — {bulkListLabel} ({filtered.length})
            </button>
          )}
          {bulkOpen && !bulkProgress && (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              <button
                onClick={sendBulk}
                disabled={!bulkText.trim()}
                className="w-full rounded-md bg-[#0b2545] px-2 py-1.5 text-sm font-medium text-white hover:bg-[#122f5c] disabled:opacity-50"
              >
                Enviar pra {filtered.length} lead(s)
              </button>
            </div>
          )}
          {bulkProgress && (
            <div className="rounded-md bg-sky-50 px-2 py-1.5 text-xs text-sky-800">
              Enviando... {bulkProgress.done}/{bulkProgress.total}
            </div>
          )}
          {bulkResult && <div className="rounded-md bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">{bulkResult}</div>}
        </div>
        {selecting && (
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
              Selecionar todos ({filtered.length})
            </label>
            <button
              onClick={deleteSelected}
              disabled={selected.size === 0 || !!bulkDeleting}
              className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {bulkDeleting
                ? `Excluindo ${bulkDeleting.done}/${bulkDeleting.total}...`
                : `Excluir selecionados (${selected.size})`}
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-4 text-sm text-slate-500">Carregando...</div>}
          {!loading && conversations.length === 0 && (
            <div className="p-4 text-sm text-slate-500">Nenhuma conversa ainda</div>
          )}
          {!loading && conversations.length > 0 && filtered.length === 0 && (
            <div className="p-4 text-sm text-slate-500">Nenhuma conversa encontrada com esse filtro</div>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => (selecting ? toggleSelected(c.leadId) : setSelectedLeadId(c.leadId))}
              className={`w-full border-b border-slate-200 px-4 py-3 text-left hover:bg-slate-100 ${
                selecting && selected.has(c.leadId)
                  ? "bg-red-500/10"
                  : selectedLeadId === c.leadId
                    ? "bg-slate-100"
                    : c.unread
                      ? "bg-emerald-500/10"
                      : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 font-medium text-sm text-slate-900">
                  {selecting && (
                    <input
                      type="checkbox"
                      checked={selected.has(c.leadId)}
                      readOnly
                      className="pointer-events-none shrink-0"
                    />
                  )}
                  {c.unread && (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" title="Não lida" />
                  )}
                  <span className="truncate">{conversationTitle(c)}</span>
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {c.lastMessage && (
                    <span className="text-[10px] text-slate-500">{fmtLastMessageAt(c.lastMessage.createdAt)}</span>
                  )}
                  <StatusBadge status={c.lead.status} />
                </div>
              </div>
              <div className={`mt-0.5 truncate text-xs ${c.unread ? "text-slate-800" : "text-slate-500"}`}>
                {c.lastMessage ? `${SENDER_PREFIX[c.lastMessage.sender]}${c.lastMessage.content}` : "Sem mensagens"}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {leadDdd(c.lead) && (
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      leadDdd(c.lead) === HOME_DDD ? "bg-emerald-500/15 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    DDD {leadDdd(c.lead)}
                  </span>
                )}
                {needsMe(c) && c.lastMessage && (
                  <span className="inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                    ⏳ esperando há {fmtWaiting(now - new Date(c.lastMessage.createdAt).getTime())}
                  </span>
                )}
                {!c.aiEnabled ? (
                  <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                    IA desativada
                  </span>
                ) : (
                  !isAiActiveNow(c) && (
                    <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                      IA pausada
                    </span>
                  )
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
        {selectedLeadId ? (
          <ConversationPanel leadId={selectedLeadId} onSent={() => openNextInQueue(selectedLeadId)} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Selecione uma conversa
          </div>
        )}
      </div>
    </div>
  );
}
