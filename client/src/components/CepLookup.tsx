import { useState } from "react";
import { api } from "../lib/api";

interface CepResult {
  cep: string;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

export function CepLookup({ onFound }: { onFound: (result: CepResult) => void }) {
  const [cep, setCep] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch() {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) {
      setError("CEP deve ter 8 dígitos");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/cep/${digits}`);
      onFound(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível consultar esse CEP agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <input
          value={cep}
          onChange={(e) => setCep(e.target.value.replace(/\D/g, "").slice(0, 8))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSearch();
            }
          }}
          placeholder="CEP"
          inputMode="numeric"
          className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-500 disabled:opacity-50"
        >
          {loading ? "Buscando..." : "Buscar CEP"}
        </button>
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}
