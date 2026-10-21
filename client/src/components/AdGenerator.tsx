import { useState } from "react";
import { api } from "../lib/api";
import { Lead } from "../lib/types";

export function AdGenerator({ lead }: { lead: Lead }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await api.post(`/leads/${lead.id}/generate-ad`);
      setTitle(res.data.title);
      setDescription(res.data.description);
    } catch {
      setError("Não foi possível gerar o anúncio agora.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(`${title}\n\n${description}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const hasVehicleData = lead.vehicleBrand || lead.vehicleModel || lead.vehicleInfo;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-600">Anúncio do veículo</span>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading || !hasVehicleData}
          className="rounded-md bg-[#0b2545] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#122f5c] disabled:opacity-50"
        >
          {loading ? "Gerando..." : title ? "Gerar de novo" : "Gerar anúncio"}
        </button>
      </div>

      {!hasVehicleData && (
        <div className="text-xs text-slate-500">
          Preencha os dados do veículo (marca/modelo ou busca FIPE) para gerar o anúncio.
        </div>
      )}
      {error && <div className="text-xs text-red-600">{error}</div>}

      {title && (
        <div className="space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-medium"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={handleCopy}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            {copied ? "Copiado!" : "Copiar anúncio"}
          </button>
          <div className="text-[11px] text-slate-500">
            Você pode editar o texto acima antes de copiar. Não esqueça de anexar as fotos do veículo ao postar.
          </div>
        </div>
      )}
    </div>
  );
}
