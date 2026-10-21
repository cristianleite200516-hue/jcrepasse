import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

// Formato de gravação preferido: OGG/Opus já é o de mensagem de voz do WhatsApp (Firefox grava);
// Chrome grava WebM e Safari MP4 — o servidor converte esses pra OGG antes de mandar.
function pickMimeType() {
  const candidates = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}

function fmtDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const MAX_SECONDS = 5 * 60;

// 🎤 grava, ✓ envia como mensagem de voz, ✕ descarta.
export function AudioRecorderButton({
  leadId,
  onSent,
  onError,
}: {
  leadId: string;
  onSent?: () => void;
  onError: (message: string | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  function stopTracks() {
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
  }

  // Trocar de conversa no meio da gravação descarta o áudio em vez de mandar pro lead errado.
  useEffect(() => {
    return () => {
      discardRef.current = true;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      stopTracks();
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [leadId]);

  async function upload(blob: Blob, mimeType: string) {
    setSending(true);
    onError(null);
    try {
      const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
      const form = new FormData();
      form.append("audio", blob, `audio.${ext}`);
      await api.post(`/conversations/${leadId}/audio`, form);
      onSent?.();
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error;
      onError(typeof serverMsg === "string" ? `Não foi possível enviar o áudio: ${serverMsg}` : "Não foi possível enviar o áudio.");
    } finally {
      setSending(false);
    }
  }

  async function start() {
    onError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError("Sem acesso ao microfone — permita o microfone pra este site no navegador.");
      return;
    }
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    discardRef.current = false;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timerRef.current) window.clearInterval(timerRef.current);
      setRecording(false);
      if (discardRef.current) return;
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      if (blob.size > 0) upload(blob, type);
    };
    recorderRef.current = recorder;
    recorder.start();
    setSeconds(0);
    setRecording(true);
    timerRef.current = window.setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) recorder.stop();
        return s + 1;
      });
    }, 1000);
  }

  function finish(discard: boolean) {
    discardRef.current = discard;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  if (recording) {
    return (
      <div className="flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-1">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
        <span className="w-10 text-xs font-medium tabular-nums text-red-700">{fmtDuration(seconds)}</span>
        <button
          type="button"
          onClick={() => finish(true)}
          title="Descartar áudio"
          className="rounded px-1.5 py-1 text-xs text-slate-600 hover:bg-white"
        >
          ✕
        </button>
        <button
          type="button"
          onClick={() => finish(false)}
          title="Enviar áudio"
          className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
        >
          ✓ Enviar
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={sending}
      title="Gravar áudio"
      className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
    >
      {sending ? "…" : "🎤"}
    </button>
  );
}
