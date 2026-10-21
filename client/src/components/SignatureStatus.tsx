import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { DocType, DocumentSignature } from "../lib/types";

const DOC_LABELS: Record<DocType, string> = {
  PROCURACAO: "procuração",
  CONTRATO_REPASSE: "contrato de repasse",
};

export function SignatureStatus({ leadId, docType }: { leadId: string; docType: DocType }) {
  const [signatures, setSignatures] = useState<DocumentSignature[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await api.get(`/signatures/leads/${leadId}`);
    setSignatures(res.data);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => {
    function onUpdated(payload: { leadId: string }) {
      if (payload.leadId === leadId) load();
    }
    socket.on("signature:updated", onUpdated);
    return () => {
      socket.off("signature:updated", onUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const latest = signatures.find((s) => s.docType === docType);

  async function createAndSend() {
    setError(null);
    setCreating(true);
    try {
      await api.post("/signatures", { leadId, docType, sendViaWhatsApp: true });
      await load();
    } catch (err: any) {
      const missing = err?.response?.data?.missing;
      setError(
        Array.isArray(missing) && missing.length > 0
          ? `Falta preencher: ${missing.join(", ")}.`
          : "Não foi possível gerar o link de assinatura."
      );
    } finally {
      setCreating(false);
    }
  }

  if (latest?.status === "ASSINADO") {
    return (
      <div className="text-xs text-emerald-600">
        ✅ {DOC_LABELS[docType]} assinada por {latest.signerName}
        {latest.signedAt && ` em ${new Date(latest.signedAt).toLocaleString("pt-BR")}`}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={createAndSend}
        disabled={creating}
        className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        {creating
          ? "Gerando..."
          : latest?.status === "PENDENTE"
            ? `Reenviar link de assinatura (${DOC_LABELS[docType]})`
            : `Enviar ${DOC_LABELS[docType]} pra assinar (WhatsApp)`}
      </button>
      {latest?.status === "PENDENTE" && (
        <div className="text-[11px] text-slate-500">Aguardando assinatura...</div>
      )}
      {error && <div className="text-[11px] text-red-600">{error}</div>}
    </div>
  );
}
