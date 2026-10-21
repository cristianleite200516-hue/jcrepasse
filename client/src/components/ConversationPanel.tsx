import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { isAiActiveNow, LeadWithConversation, LEAD_STATUSES, Message, STATUS_LABELS } from "../lib/types";
import { ConversationThread } from "./ConversationThread";
import { NewAppointmentForm } from "./NewAppointmentForm";
import { QuickRepliesMenu } from "./QuickRepliesMenu";
import { AudioRecorderButton } from "./AudioRecorderButton";
import { fillQuickReply } from "../lib/leadDisplay";

function fmtHour(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ConversationPanel({
  leadId,
  onDeleted,
  onSent,
}: {
  leadId: string;
  onDeleted?: () => void;
  // Chamado depois de uma mensagem enviada com sucesso — a fila "Precisa de mim" usa pra abrir a próxima.
  onSent?: () => void;
}) {
  const [lead, setLead] = useState<LeadWithConversation | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingLocation, setSendingLocation] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState<string | null | undefined>(undefined);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showNewAppointment, setShowNewAppointment] = useState(false);
  const [showSummary, setShowSummary] = useState(true);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLead(null);
    setDraft("");
    setError(null);
    setWhatsappNumber(undefined);
    setAiSummary(null);
    api.get(`/leads/${leadId}`).then((res) => {
      if (!cancelled) setLead(res.data);
    });
    api.patch(`/conversations/${leadId}/read`).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  async function summarize() {
    setSummarizing(true);
    try {
      const res = await api.post(`/conversations/${leadId}/summary`);
      setAiSummary(res.data.summary);
    } catch {
      setAiSummary("Não foi possível gerar o resumo agora.");
    } finally {
      setSummarizing(false);
    }
  }

  useEffect(() => {
    if (!lead?.phone.endsWith("@lid")) return;
    let cancelled = false;
    api.get(`/conversations/${lead.id}/whatsapp-number`).then((res) => {
      if (!cancelled) setWhatsappNumber(res.data.number);
    });
    return () => {
      cancelled = true;
    };
  }, [lead?.id, lead?.phone]);

  useEffect(() => {
    function onMessage(payload: { leadId: string; message: Message }) {
      if (payload.leadId !== leadId) return;
      setLead((prev) =>
        prev && prev.conversation
          ? { ...prev, conversation: { ...prev.conversation, messages: [...prev.conversation.messages, payload.message] } }
          : prev
      );
    }
    function onLeadUpdated(updated: LeadWithConversation) {
      if (updated.id !== leadId) return;
      setLead((prev) => (prev ? { ...prev, ...updated } : prev));
    }
    function onConversationUpdated(conv: { id: string; leadId: string; aiEnabled?: boolean; aiPausedUntil?: string | null }) {
      setLead((prev) =>
        prev && prev.conversation?.id === conv.id
          ? {
              ...prev,
              conversation: {
                ...prev.conversation,
                ...(conv.aiEnabled !== undefined ? { aiEnabled: conv.aiEnabled } : {}),
                ...("aiPausedUntil" in conv ? { aiPausedUntil: conv.aiPausedUntil } : {}),
              },
            }
          : prev
      );
    }
    function onMessageDeleted(payload: { leadId: string; message: Message }) {
      if (payload.leadId !== leadId) return;
      setLead((prev) =>
        prev && prev.conversation
          ? {
              ...prev,
              conversation: {
                ...prev.conversation,
                messages: prev.conversation.messages.map((m) => (m.id === payload.message.id ? payload.message : m)),
              },
            }
          : prev
      );
    }
    socket.on("message:new", onMessage);
    socket.on("lead:updated", onLeadUpdated);
    socket.on("conversation:updated", onConversationUpdated);
    socket.on("message:deleted", onMessageDeleted);
    return () => {
      socket.off("message:new", onMessage);
      socket.off("lead:updated", onLeadUpdated);
      socket.off("conversation:updated", onConversationUpdated);
      socket.off("message:deleted", onMessageDeleted);
    };
  }, [leadId]);

  async function send(returnToAi: boolean) {
    if (!draft.trim() || !lead) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/conversations/${lead.id}/messages`, { content: draft, returnToAi });
      setDraft("");
      onSent?.();
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error;
      setError(
        typeof serverMsg === "string"
          ? `Não foi possível enviar: ${serverMsg}`
          : "Não foi possível enviar. O WhatsApp está conectado?"
      );
    } finally {
      setSending(false);
    }
  }

  function handleSend(e: FormEvent) {
    e.preventDefault();
    send(false);
  }

  function startEditingName() {
    if (!lead) return;
    setNameDraft(lead.name ?? "");
    setEditingName(true);
  }

  async function saveName() {
    if (!lead) return;
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (trimmed === (lead.name ?? "")) return;
    setSavingName(true);
    try {
      const res = await api.patch(`/leads/${lead.id}`, { name: trimmed });
      setLead((prev) => (prev ? { ...prev, ...res.data } : prev));
    } catch {
      setError("Não foi possível salvar o nome.");
    } finally {
      setSavingName(false);
    }
  }

  async function deleteLead() {
    if (!lead) return;
    const confirmText = window.prompt(
      `Isso apaga o lead "${lead.name || lead.phone}" e TODA a conversa, anexos e agendamentos dele — não tem como desfazer.\n\nPra confirmar, digite EXCLUIR:`
    );
    if (confirmText !== "EXCLUIR") return;
    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/leads/${lead.id}`);
      onDeleted?.();
    } catch {
      setError("Não foi possível excluir o lead.");
      setDeleting(false);
    }
  }

  async function changeStatus(status: string) {
    if (!lead) return;
    const body: Record<string, unknown> = { status };
    if (status === "PERDIDO") {
      const reason = window.prompt("Motivo da perda (ex: preço, concorrência, desistiu):", lead.lossReason ?? "");
      if (reason === null) return; // cancelou
      body.lossReason = reason || null;
    }
    const res = await api.patch(`/leads/${lead.id}`, body);
    setLead((prev) => (prev ? { ...prev, ...res.data } : prev));
  }

  // Ativa → desliga de vez. Pausada (equipe respondeu) ou desligada → volta a atender agora.
  async function toggleAI() {
    if (!lead?.conversation) return;
    const aiOn = isAiActiveNow(lead.conversation);
    await api.patch(`/conversations/${lead.id}/ai-toggle`, { aiEnabled: !aiOn });
  }

  async function sendLocation() {
    if (!lead) return;
    setSendingLocation(true);
    setError(null);
    try {
      await api.post(`/conversations/${lead.id}/location`);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível enviar a localização.");
    } finally {
      setSendingLocation(false);
    }
  }

  if (!lead) return <div className="flex-1 flex items-center justify-center text-sm text-slate-500">Carregando...</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div>
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditingName(false);
              }}
              placeholder="Nome do contato"
              className="rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 text-sm font-semibold text-slate-900"
            />
          ) : (
            <button
              onClick={startEditingName}
              title="Clique pra editar o nome"
              className="font-semibold text-slate-900 hover:underline"
            >
              {lead.name || "Sem nome"} {savingName ? "" : "✏️"}
            </button>
          )}
          <div className="text-xs text-slate-500">{lead.phone}</div>
          {lead.phone.endsWith("@lid") && (
            <div className="text-xs text-sky-600">
              {whatsappNumber === undefined
                ? "Buscando número real..."
                : whatsappNumber
                  ? `Número p/ localizar no WhatsApp: ${whatsappNumber}`
                  : "Número real indisponível (privacidade do contato)"}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={lead.status}
            onChange={(e) => changeStatus(e.target.value)}
            title="Mover no funil"
            className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-800"
          >
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {lead.conversation && (
            <button
              onClick={toggleAI}
              title={
                isAiActiveNow(lead.conversation)
                  ? "Clique pra desligar a IA nessa conversa"
                  : "Clique pra IA voltar a atender agora"
              }
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                isAiActiveNow(lead.conversation)
                  ? "bg-indigo-500/15 text-indigo-700"
                  : lead.conversation.aiEnabled
                    ? "bg-amber-500/15 text-amber-700"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {isAiActiveNow(lead.conversation)
                ? "IA ativa"
                : lead.conversation.aiEnabled && lead.conversation.aiPausedUntil
                  ? `IA volta às ${fmtHour(lead.conversation.aiPausedUntil)}`
                  : "IA desativada"}
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowNewAppointment((v) => !v)}
              title="Agendar avaliação"
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-800 hover:bg-slate-200"
            >
              + Agendar
            </button>
            {showNewAppointment && (
              <NewAppointmentForm fixedLead={lead} onClose={() => setShowNewAppointment(false)} />
            )}
          </div>
          <button
            onClick={deleteLead}
            disabled={deleting}
            title="Excluir lead e conversa"
            className="rounded-full px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/15 disabled:opacity-50"
          >
            {deleting ? "Excluindo..." : "🗑️"}
          </button>
        </div>
      </div>
      {(lead.notes || lead.vehicleInfo || lead.askingPrice || lead.urgency) && (
        <div className="border-b border-slate-200 bg-amber-50/60 px-4 py-2 text-xs text-slate-700">
          <button
            type="button"
            onClick={() => setShowSummary((v) => !v)}
            className="font-semibold uppercase tracking-wide text-amber-800"
          >
            Resumo do lead {showSummary ? "▾" : "▸"}
          </button>
          {showSummary && (
            <div className="mt-1 space-y-0.5">
              {lead.vehicleInfo && <div>🚗 {lead.vehicleInfo}</div>}
              {(lead.askingPrice || lead.urgency) && (
                <div>
                  {lead.askingPrice && <>💰 Quer {lead.askingPrice}</>}
                  {lead.askingPrice && lead.urgency && " · "}
                  {lead.urgency && <>⏱ {lead.urgency}</>}
                </div>
              )}
              {lead.notes && <div className="whitespace-pre-wrap text-slate-600">{lead.notes}</div>}
            </div>
          )}
          {showSummary && (
            <div className="mt-2">
              {aiSummary ? (
                <div className="whitespace-pre-wrap rounded-md bg-white/70 p-2 text-slate-700">{aiSummary}</div>
              ) : null}
              <button
                type="button"
                onClick={summarize}
                disabled={summarizing}
                className="mt-1 font-medium text-sky-700 hover:underline disabled:opacity-50"
              >
                {summarizing ? "Resumindo..." : aiSummary ? "↻ Resumir de novo" : "✨ Resumir a conversa com IA"}
              </button>
            </div>
          )}
        </div>
      )}
      <ConversationThread messages={lead.conversation?.messages ?? []} />
      <form onSubmit={handleSend} className="flex items-end gap-2 border-t border-slate-200 bg-white p-3">
        <button
          type="button"
          onClick={sendLocation}
          disabled={sendingLocation}
          title="Enviar localização da loja"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >
          📍
        </button>
        <AudioRecorderButton leadId={lead.id} onSent={onSent} onError={setError} />
        <QuickRepliesMenu
          onPick={(raw) => {
            const text = fillQuickReply(raw, lead);
            setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
            inputRef.current?.focus();
          }}
        />
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia; Shift+Enter quebra linha (respostas rápidas podem ter várias linhas).
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(false);
            }
          }}
          rows={1}
          placeholder="Digite uma mensagem..."
          className="max-h-32 min-h-[38px] flex-1 resize-y rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="flex flex-col gap-1">
          <button
            type="submit"
            disabled={sending}
            title="Envia e pausa a IA por 2h nessa conversa"
            className="rounded-md bg-[#0b2545] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Enviar
          </button>
          <button
            type="button"
            onClick={() => send(true)}
            disabled={sending}
            title="Envia e a IA continua atendendo essa conversa na hora"
            className="rounded-md border border-indigo-300 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            Enviar + IA segue
          </button>
        </div>
      </form>
      {error && <div className="px-3 pb-2 text-xs text-red-600">{error}</div>}
    </div>
  );
}
