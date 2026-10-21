import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, API_HOST } from "../lib/api";

interface SignatureInfo {
  docType: string;
  docLabel: string;
  status: "PENDENTE" | "ASSINADO";
  leadName: string | null;
  signerName: string | null;
  signedAt: string | null;
}

export function SignDocument() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<SignatureInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSigned, setJustSigned] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .get(`/signatures/public/${token}`)
      .then((res) => setInfo(res.data))
      .catch(() => setNotFound(true));
  }, [token]);

  async function handleSign() {
    if (!token) return;
    setError(null);
    if (signerName.trim().length < 3) {
      setError("Digite seu nome completo.");
      return;
    }
    if (!agreed) {
      setError("Confirme que você leu o documento acima.");
      return;
    }
    setSigning(true);
    try {
      await api.post(`/signatures/public/${token}/sign`, { signerName: signerName.trim() });
      setJustSigned(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível confirmar a assinatura.");
    } finally {
      setSigning(false);
    }
  }

  if (notFound) {
    return (
      <PageShell>
        <p className="text-slate-600">Link de assinatura não encontrado ou inválido.</p>
      </PageShell>
    );
  }

  if (!info) {
    return (
      <PageShell>
        <p className="text-slate-500">Carregando...</p>
      </PageShell>
    );
  }

  const signed = info.status === "ASSINADO" || justSigned;

  return (
    <PageShell>
      <h1 className="mb-1 text-xl font-bold text-slate-900">{info.docLabel}</h1>
      {info.leadName && <p className="mb-4 text-sm text-slate-500">Referente a: {info.leadName}</p>}

      <div className="mb-4 overflow-hidden rounded-lg border border-slate-200" style={{ height: "70vh" }}>
        <iframe title="Documento" src={`${API_HOST}/api/signatures/public/${token}/pdf`} className="h-full w-full" />
      </div>

      {signed ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-700">
          <div className="font-semibold">✅ Documento assinado</div>
          <p className="mt-1 text-sm">
            Assinado por <strong>{justSigned ? signerName : info.signerName}</strong>
            {info.signedAt && !justSigned && <> em {new Date(info.signedAt).toLocaleString("pt-BR")}</>}.
          </p>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">
            Leia o documento acima. Pra confirmar que você concorda com o conteúdo, digite seu nome completo abaixo.
          </p>
          <input
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Seu nome completo"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
            Li o documento acima e concordo com o seu conteúdo.
          </label>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <button
            onClick={handleSign}
            disabled={signing}
            className="w-full rounded-md bg-[#0b2545] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {signing ? "Confirmando..." : "Confirmar assinatura"}
          </button>
          <p className="text-[11px] text-slate-500">
            Essa confirmação registra seu nome, data/hora e endereço IP como comprovante de aceite eletrônico.
          </p>
        </div>
      )}
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  );
}
