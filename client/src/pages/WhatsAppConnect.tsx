import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { useAuth } from "../lib/auth";

type Status = "DISCONNECTED" | "QR" | "CONNECTING" | "READY";

interface ImportSummary {
  chatsProcessed: number;
  leadsCreated: number;
  messagesImported: number;
}

interface StalledLeadPreview {
  leadId: string;
  name: string | null;
  phone: string;
  status: string;
  lastMessageAt: string;
}

interface ReengageSummary {
  attempted: number;
  sent: number;
  failed: number;
}

export function WhatsAppConnect() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [status, setStatus] = useState<Status>("DISCONNECTED");
  const [qr, setQr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSince, setImportSince] = useState("");

  const [days, setDays] = useState(3);
  const [preview, setPreview] = useState<StalledLeadPreview[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [reengaging, setReengaging] = useState(false);
  const [reengageResult, setReengageResult] = useState<ReengageSummary | null>(null);
  const [reengageError, setReengageError] = useState<string | null>(null);

  const [aiPaused, setAiPaused] = useState(false);
  const [togglingAi, setTogglingAi] = useState(false);

  async function load() {
    const res = await api.get("/whatsapp/status");
    setStatus(res.data.status);
    if (res.data.qr) setQr(res.data.qr);
  }

  async function loadAiPaused() {
    const res = await api.get("/settings");
    setAiPaused(!!res.data.aiPaused);
  }

  async function toggleAiPaused() {
    setTogglingAi(true);
    try {
      const res = await api.patch("/settings/ai-pause", { aiPaused: !aiPaused });
      setAiPaused(!!res.data.aiPaused);
    } finally {
      setTogglingAi(false);
    }
  }

  useEffect(() => {
    load();
    loadAiPaused();
    function onQr(payload: { qr: string }) {
      setQr(payload.qr);
    }
    function onStatus(payload: { status: Status }) {
      setStatus(payload.status);
      if (payload.status === "READY" || payload.status === "CONNECTING") setQr(null);
    }
    function onSettingsUpdated(payload: { aiPaused: boolean }) {
      setAiPaused(!!payload.aiPaused);
    }
    socket.on("whatsapp:qr", onQr);
    socket.on("whatsapp:status", onStatus);
    socket.on("settings:updated", onSettingsUpdated);
    return () => {
      socket.off("whatsapp:qr", onQr);
      socket.off("whatsapp:status", onStatus);
      socket.off("settings:updated", onSettingsUpdated);
    };
  }, []);

  async function connect() {
    await api.post("/whatsapp/connect");
    await load();
  }

  async function importChats() {
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const sinceDays = importSince
        ? Math.max(1, Math.ceil((Date.now() - new Date(`${importSince}T00:00:00`).getTime()) / (24 * 60 * 60 * 1000)))
        : undefined;
      const res = await api.post("/whatsapp/import", sinceDays ? { sinceDays } : undefined);
      setImportResult(res.data);
    } catch (err: any) {
      // Mostra o motivo real que o servidor devolveu — antes qualquer falha (timeout, erro na
      // listagem das conversas, importação já rodando) virava a mesma mensagem genérica.
      const serverMsg = err?.response?.data?.error;
      setImportError(
        serverMsg
          ? `Não foi possível importar: ${serverMsg}`
          : err?.response
            ? `Não foi possível importar (erro ${err.response.status} do servidor).`
            : "Não foi possível importar: o servidor não respondeu a tempo. A importação pode ter continuado — confira os leads em alguns minutos."
      );
    } finally {
      setImporting(false);
    }
  }

  async function loadPreview() {
    setPreviewing(true);
    setReengageError(null);
    setReengageResult(null);
    try {
      const res = await api.get("/whatsapp/stalled-leads", { params: { days } });
      setPreview(res.data);
    } catch {
      setReengageError("Não foi possível verificar os leads parados.");
    } finally {
      setPreviewing(false);
    }
  }

  // O envio roda em segundo plano (25-75 s entre mensagens); o resultado chega pelo socket.
  async function reengage() {
    if (!preview || preview.length === 0) return;
    if (
      !confirm(
        `Enviar mensagem de reengajamento da IA para ${preview.length} lead(s)? As mensagens saem aos poucos (intervalo de 25 a 75 s, até o limite diário) pra não parecer robô.`
      )
    )
      return;
    setReengaging(true);
    setReengageError(null);
    setReengageResult(null);
    try {
      await api.post("/whatsapp/reengage-stalled", { days });
      setPreview(null);
    } catch (err: any) {
      setReengageError(err?.response?.data?.error || "Não foi possível reengajar os leads. Confirme que o WhatsApp está conectado.");
      setReengaging(false);
    }
  }

  useEffect(() => {
    function onDone(summary: ReengageSummary & { error?: string }) {
      setReengaging(false);
      if (summary.error) setReengageError(summary.error);
      else setReengageResult(summary);
    }
    socket.on("reengage:done", onDone);
    return () => {
      socket.off("reengage:done", onDone);
    };
  }, []);

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-lg font-bold text-slate-900">Conexão com WhatsApp</h1>

      <div
        className={`mb-4 flex items-center justify-between rounded-lg border p-4 ${
          aiPaused ? "border-amber-600 bg-amber-50" : "border-slate-200 bg-white"
        }`}
      >
        <div>
          <div className="text-sm font-semibold text-slate-900">
            IA {aiPaused ? "pausada" : "ativa"} (interruptor geral)
          </div>
          <p className="text-xs text-slate-500">
            {aiPaused
              ? "Nenhum lead recebe resposta automática agora, nem os novos que chegarem."
              : "Responde automaticamente conforme cada conversa permitir."}
          </p>
        </div>
        <button
          onClick={toggleAiPaused}
          disabled={togglingAi}
          className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium disabled:opacity-50 ${
            aiPaused ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-slate-100 text-slate-800 hover:bg-slate-200"
          }`}
        >
          {togglingAi ? "..." : aiPaused ? "Reativar IA" : "Pausar IA"}
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
        {status === "READY" && (
          <>
            <div className="text-emerald-600 font-medium mb-4">
              ✅ WhatsApp conectado e pronto para atender.
            </div>
            <p className="mb-3 text-sm text-slate-500">
              Já tem conversas no WhatsApp de antes de conectar aqui? Importe todas para o CRM (isso não
              envia nenhuma mensagem, só traz o histórico e cria os leads).
            </p>
            <div className="mb-3 flex items-center justify-center gap-2">
              <label className="text-sm text-slate-500">Importar desde:</label>
              <input
                type="date"
                value={importSince}
                onChange={(e) => setImportSince(e.target.value)}
                className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm text-slate-800"
              />
            </div>
            <button
              onClick={importChats}
              disabled={importing}
              className="rounded-md bg-[#0b2545] px-4 py-2 text-sm font-medium text-white hover:bg-[#122f5c] disabled:opacity-50"
            >
              {importing ? "Importando..." : "Importar conversas existentes"}
            </button>
            {!importSince && (
              <p className="mt-2 text-xs text-slate-500">Sem data selecionada, importa só os últimos 3 dias.</p>
            )}
            {importResult && (
              <div className="mt-3 text-sm text-emerald-600">
                {importResult.chatsProcessed} conversas verificadas — {importResult.leadsCreated} leads novos,{" "}
                {importResult.messagesImported} mensagens importadas.
              </div>
            )}
            {importError && <div className="mt-3 text-sm text-red-600">{importError}</div>}

            <div className="mt-6 border-t border-slate-200 pt-4 text-left">
              <p className="mb-3 text-sm text-slate-500">
                Reative com a IA os leads cuja conversa está parada (sem nenhuma mensagem nova de nenhum dos
                lados) há um número de dias.
              </p>
              <div className="mb-3 flex items-center gap-2">
                <label className="text-sm text-slate-500">Dias parado:</label>
                <input
                  type="number"
                  min={0.01}
                  max={90}
                  step="any"
                  value={days}
                  onChange={(e) => {
                    setDays(Math.max(0.01, Number(e.target.value) || 0.01));
                    setPreview(null);
                  }}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
                <button
                  onClick={loadPreview}
                  disabled={previewing}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                >
                  {previewing ? "Verificando..." : "Ver quantos estão parados"}
                </button>
              </div>

              {preview && (
                <div className="mb-3 rounded-md bg-slate-50 p-3 text-sm">
                  {preview.length === 0 ? (
                    <div className="text-slate-500">Nenhum lead parado há {days} dia(s).</div>
                  ) : (
                    <>
                      <div className="mb-2 font-medium text-slate-600">
                        {preview.length} lead(s) parado(s) há {days}+ dia(s):
                      </div>
                      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-slate-500">
                        {preview.map((p) => (
                          <li key={p.leadId}>
                            {p.name || p.phone} — {p.status}
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={reengage}
                        disabled={reengaging}
                        className="mt-3 w-full rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f5c] disabled:opacity-50"
                      >
                        {reengaging ? "Enviando aos poucos..." : `Enviar reengajamento para ${preview.length} lead(s)`}
                      </button>
                    </>
                  )}
                </div>
              )}

              {reengageResult && (
                <div className="text-sm text-emerald-600">
                  {reengageResult.sent} mensagem(ns) enviada(s) de {reengageResult.attempted} tentativa(s)
                  {reengageResult.failed > 0 && `, ${reengageResult.failed} falha(s)`}.
                </div>
              )}
              {reengageError && <div className="text-sm text-red-600">{reengageError}</div>}
            </div>
          </>
        )}
        {status === "CONNECTING" && <div className="text-slate-500">Conectando...</div>}
        {status === "QR" && qr && (
          <>
            <p className="mb-3 text-sm text-slate-500">
              Escaneie o QR code abaixo com o WhatsApp do número que vai atender os leads
              (WhatsApp → Aparelhos conectados → Conectar um aparelho).
            </p>
            <img src={qr} alt="QR Code do WhatsApp" className="mx-auto w-80 h-80" />
          </>
        )}
        {status === "DISCONNECTED" && (
          <>
            <p className="mb-3 text-sm text-slate-500">
              O WhatsApp ainda não está conectado. Clique abaixo para gerar o QR code.
            </p>
            <button
              onClick={connect}
              className="rounded-md bg-[#0b2545] px-4 py-2 text-sm font-medium text-white hover:bg-[#122f5c]"
            >
              Conectar WhatsApp
            </button>
          </>
        )}
      </div>
      {isAdmin && <AiReenableTool />}
    </div>
  );
}

interface AiReenableItem {
  leadId: string;
  name: string | null;
  phone: string;
  status: string;
  vehicleInfo: string | null;
}

// Religa a IA nas conversas que ficaram desligadas por resposta manual (antes da pausa de 2h
// existir), deixando de fora as que a própria IA passou pra equipe. Mostra antes o que vai mudar.
function AiReenableTool() {
  const [preview, setPreview] = useState<{ toReenable: AiReenableItem[]; handedOff: AiReenableItem[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const label = (i: AiReenableItem) =>
    [i.name, i.vehicleInfo?.split(",")[0]].filter(Boolean).join(" · ") ||
    (i.phone.endsWith("@lid") ? `WhatsApp privado ···${i.phone.slice(-8, -4)}` : i.phone);

  async function loadPreview() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.get("/whatsapp/ai-reenable/preview");
      setPreview(res.data);
    } catch {
      setError("Falha ao verificar as conversas");
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (!preview || !confirm(`Religar a IA em ${preview.toReenable.length} conversa(s)?`)) return;
    setApplying(true);
    setError(null);
    try {
      const res = await api.post("/whatsapp/ai-reenable");
      setResult(
        `IA religada em ${res.data.reenabled} conversa(s). ${res.data.keptHandedOff} passada(s) pra equipe continuam com a IA desligada.`
      );
      setPreview(null);
    } catch {
      setError("Falha ao religar a IA");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-6 text-left">
      <h2 className="font-semibold text-slate-900">Religar IA nas conversas desligadas</h2>
      <p className="mt-1 text-sm text-slate-500">
        Conversas em que a IA ficou desligada por uma resposta manual. Ficam de fora as que a própria IA passou pra
        você (assunto de endereço/localização) e leads em Proposta, Ganho ou Fechado. A IA só volta a responder
        quando o lead mandar mensagem — nada é enviado agora.
      </p>
      <button
        onClick={loadPreview}
        disabled={loading}
        className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        {loading ? "Verificando..." : "Ver quais conversas"}
      </button>

      {preview && (
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <div className="mb-1 font-medium text-slate-700">{preview.toReenable.length} serão religadas:</div>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md bg-slate-50 p-2 text-xs text-slate-600">
              {preview.toReenable.map((i) => (
                <li key={i.leadId}>
                  {label(i)} — {i.status}
                </li>
              ))}
              {preview.toReenable.length === 0 && <li>Nenhuma.</li>}
            </ul>
          </div>
          <div>
            <div className="mb-1 font-medium text-slate-700">
              {preview.handedOff.length} ficam desligadas (passadas pra você):
            </div>
            <ul className="max-h-32 space-y-0.5 overflow-y-auto rounded-md bg-slate-50 p-2 text-xs text-slate-500">
              {preview.handedOff.map((i) => (
                <li key={i.leadId}>
                  {label(i)} — {i.status}
                </li>
              ))}
              {preview.handedOff.length === 0 && <li>Nenhuma.</li>}
            </ul>
          </div>
          <button
            onClick={apply}
            disabled={applying || preview.toReenable.length === 0}
            className="w-full rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f5c] disabled:opacity-50"
          >
            {applying ? "Religando..." : `Religar IA em ${preview.toReenable.length} conversa(s)`}
          </button>
        </div>
      )}
      {result && <div className="mt-3 text-sm text-emerald-600">{result}</div>}
      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
    </div>
  );
}
