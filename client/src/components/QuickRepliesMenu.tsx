import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { QuickReply } from "../lib/types";

function parseQuickReplies(raw: unknown): QuickReply[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.title === "string" && typeof r.text === "string") : [];
  } catch {
    return [];
  }
}

// Respostas prontas da equipe (PIX, documentos, horário...): um clique coloca o texto na caixa de
// mensagem pra revisar e enviar. A lista é compartilhada por todo mundo e editada aqui mesmo.
export function QuickRepliesMenu({ onPick }: { onPick: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftText, setDraftText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get("/settings").then((res) => setReplies(parseQuickReplies(res.data?.quickReplies))).catch(() => {});
    function onSettingsUpdated(settings: { quickReplies?: string | null }) {
      if ("quickReplies" in settings) setReplies(parseQuickReplies(settings.quickReplies));
    }
    socket.on("settings:updated", onSettingsUpdated);
    return () => {
      socket.off("settings:updated", onSettingsUpdated);
    };
  }, []);

  async function save(next: QuickReply[]) {
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch("/settings/quick-replies", { quickReplies: next });
      setReplies(res.data);
      return true;
    } catch {
      setError("Não foi possível salvar.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addReply() {
    if (!draftTitle.trim() || !draftText.trim()) return;
    if (await save([...replies, { title: draftTitle.trim(), text: draftText.trim() }])) {
      setDraftTitle("");
      setDraftText("");
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Respostas rápidas"
        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
      >
        ⚡
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-80 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase text-slate-500">Respostas rápidas</span>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="text-xs font-medium text-sky-700 hover:underline"
            >
              {editing ? "Concluir" : "Editar"}
            </button>
          </div>

          {replies.length === 0 && !editing && (
            <div className="px-1 py-2 text-xs text-slate-500">
              Nenhuma ainda. Clique em "Editar" pra cadastrar as frases que você repete (PIX, documentos, horário...).
            </div>
          )}

          <div className="max-h-64 overflow-y-auto">
            {replies.map((r, i) => (
              <div key={i} className="flex items-start gap-1">
                <button
                  type="button"
                  disabled={editing}
                  onClick={() => {
                    onPick(r.text);
                    setOpen(false);
                  }}
                  className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left hover:bg-slate-100 disabled:hover:bg-transparent"
                >
                  <div className="text-sm font-medium text-slate-900">{r.title}</div>
                  <div className="truncate text-xs text-slate-500">{r.text}</div>
                </button>
                {editing && (
                  <button
                    type="button"
                    onClick={() => save(replies.filter((_, j) => j !== i))}
                    disabled={saving}
                    title="Remover"
                    className="mt-1 rounded px-1.5 text-xs text-red-600 hover:bg-red-500/10"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          {editing && (
            <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Título (ex: PIX na hora)"
                maxLength={40}
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              <textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder="Texto da mensagem"
                rows={3}
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={addReply}
                disabled={saving || !draftTitle.trim() || !draftText.trim()}
                className="w-full rounded-md bg-[#0b2545] px-2 py-1 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Adicionar"}
              </button>
            </div>
          )}
          {error && <div className="mt-1 px-1 text-xs text-red-600">{error}</div>}
        </div>
      )}
    </div>
  );
}
