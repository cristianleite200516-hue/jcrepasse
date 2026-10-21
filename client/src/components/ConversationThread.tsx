import { Fragment, useEffect, useRef, useState } from "react";
import { API_HOST, api } from "../lib/api";
import { Message } from "../lib/types";

const DELETED_PLACEHOLDER = "🚫 Mensagem apagada";
// Texto que o servidor grava quando a foto/documento chega sem legenda — com a mídia aparecendo no
// próprio balão, repetir isso embaixo só polui.
const MEDIA_PLACEHOLDERS = new Set(["📷 Foto enviada", "📄 Documento enviado"]);

function attachmentUrl(id: string) {
  return `${API_HOST}/api/attachments/${id}/file`;
}

// HEIC (padrão de foto do iPhone) não abre direto no navegador — pra esse caso fica só o link.
function isBrowserImage(mimeType: string) {
  return mimeType.startsWith("image/") && !/hei[cf]/i.test(mimeType);
}

const SENDER_STYLES: Record<Message["sender"], string> = {
  LEAD: "self-start bg-white text-slate-900 border border-slate-200",
  AI: "self-end bg-indigo-600 text-white",
  AGENT: "self-end bg-emerald-600 text-white",
};

const SENDER_LABELS: Record<Message["sender"], string> = {
  LEAD: "Lead",
  AI: "IA",
  AGENT: "Você",
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function ConversationThread({ messages }: { messages: Message[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewingPhotoId, setViewingPhotoId] = useState<string | null>(null);

  useEffect(() => {
    if (!viewingPhotoId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setViewingPhotoId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewingPhotoId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function deleteMessage(id: string) {
    if (
      !confirm(
        "Apagar essa mensagem pra todos no WhatsApp? Só funciona se ela ainda estiver dentro da janela de tempo que o WhatsApp permite revogar."
      )
    )
      return;
    setDeletingId(id);
    try {
      await api.delete(`/conversations/messages/${id}`);
    } catch (err: any) {
      alert(err?.response?.data?.error || "Não foi possível apagar a mensagem.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto p-4 flex-1">
      {messages.map((m, i) => (
        <Fragment key={m.id}>
          {(i === 0 || !sameDay(messages[i - 1].createdAt, m.createdAt)) && (
            <div className="self-center my-2 text-center text-[10px] font-medium uppercase tracking-wide text-slate-500">
              {fmtDayLabel(m.createdAt)}
            </div>
          )}
          <div className={`group relative max-w-[75%] rounded-lg px-3 py-2 text-sm ${SENDER_STYLES[m.sender]}`}>
            <div className="text-[10px] opacity-70 mb-0.5">
              {SENDER_LABELS[m.sender]} · {fmtTime(m.createdAt)}
            </div>
            {m.attachment && m.attachment.category !== "AUDIO" && isBrowserImage(m.attachment.mimeType) && (
              <button
                type="button"
                onClick={() => setViewingPhotoId(m.attachment!.id)}
                className="mb-1 block overflow-hidden rounded-md"
                title="Abrir foto"
              >
                <img
                  src={attachmentUrl(m.attachment.id)}
                  alt="Foto enviada pelo lead"
                  loading="lazy"
                  className="max-h-64 w-auto max-w-full object-cover"
                />
              </button>
            )}
            {m.attachment && m.attachment.category !== "AUDIO" && !isBrowserImage(m.attachment.mimeType) && (
              <a
                href={attachmentUrl(m.attachment.id)}
                target="_blank"
                rel="noreferrer"
                className="mb-1 inline-block rounded-md border border-current px-2 py-1 text-xs font-medium underline"
              >
                {m.attachment.mimeType.startsWith("image/") ? "📷 Abrir foto" : "📄 Abrir documento"}
              </a>
            )}
            {!(m.attachment && MEDIA_PLACEHOLDERS.has(m.content)) && (
              <div className="whitespace-pre-wrap">
                {m.content === DELETED_PLACEHOLDER ? <span className="italic opacity-70">{m.content}</span> : m.content}
              </div>
            )}
            {m.attachment?.category === "AUDIO" && (
              <audio controls src={`${API_HOST}/api/attachments/${m.attachment.id}/file`} className="mt-1 h-8 w-full" />
            )}
            {m.sender !== "LEAD" && m.content !== DELETED_PLACEHOLDER && (
              <button
                onClick={() => deleteMessage(m.id)}
                disabled={deletingId === m.id}
                title="Apagar para todos no WhatsApp"
                className="absolute -top-2 -left-2 hidden h-5 w-5 items-center justify-center rounded-full bg-slate-50 text-[10px] text-red-600 shadow hover:bg-white group-hover:flex disabled:opacity-50"
              >
                🗑
              </button>
            )}
          </div>
        </Fragment>
      ))}
      {messages.length === 0 && (
        <div className="text-sm text-slate-500 text-center mt-8">Nenhuma mensagem ainda</div>
      )}
      <div ref={endRef} />
      {viewingPhotoId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setViewingPhotoId(null)}
        >
          <img
            src={attachmentUrl(viewingPhotoId)}
            alt="Foto em tamanho real"
            className="max-h-full max-w-full rounded-md object-contain"
          />
          <div className="absolute right-4 top-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <a
              href={attachmentUrl(viewingPhotoId)}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-white"
            >
              Abrir em nova aba
            </a>
            <button
              onClick={() => setViewingPhotoId(null)}
              className="rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-white"
            >
              Fechar ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
