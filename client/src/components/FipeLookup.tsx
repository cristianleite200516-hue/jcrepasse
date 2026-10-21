import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface FipeOption {
  codigo: string;
  nome: string;
}

interface FipeResult {
  Valor: string;
  Marca: string;
  Modelo: string;
  AnoModelo: number;
  CodigoFipe: string;
  MesReferencia?: string;
}

type TipoVeiculo = "carros" | "motos" | "caminhoes";

const TIPO_LABELS: Record<TipoVeiculo, string> = {
  carros: "Carro",
  motos: "Moto",
  caminhoes: "Caminhão",
};

export function FipeLookup({ onFound }: { onFound: (result: FipeResult) => void }) {
  const [tipo, setTipo] = useState<TipoVeiculo>("carros");
  const [marcas, setMarcas] = useState<FipeOption[]>([]);
  const [modelos, setModelos] = useState<FipeOption[]>([]);
  const [anos, setAnos] = useState<FipeOption[]>([]);
  const [marcaId, setMarcaId] = useState("");
  const [modeloId, setModeloId] = useState("");
  const [anoId, setAnoId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FipeResult | null>(null);

  useEffect(() => {
    setMarcaId("");
    setModeloId("");
    setAnoId("");
    setModelos([]);
    setAnos([]);
    setResult(null);
    api.get("/fipe/marcas", { params: { tipo } }).then((res) => setMarcas(res.data));
  }, [tipo]);

  async function handleMarca(id: string) {
    setMarcaId(id);
    setModeloId("");
    setAnoId("");
    setModelos([]);
    setAnos([]);
    setResult(null);
    if (!id) return;
    const res = await api.get(`/fipe/marcas/${id}/modelos`, { params: { tipo } });
    setModelos(res.data);
  }

  async function handleModelo(id: string) {
    setModeloId(id);
    setAnoId("");
    setAnos([]);
    setResult(null);
    if (!id) return;
    const res = await api.get(`/fipe/marcas/${marcaId}/modelos/${id}/anos`, { params: { tipo } });
    setAnos(res.data);
  }

  async function handleAno(id: string) {
    setAnoId(id);
    setResult(null);
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/fipe/marcas/${marcaId}/modelos/${modeloId}/anos/${id}`, { params: { tipo } });
      setResult(res.data);
      onFound(res.data);
    } catch {
      setError("Não foi possível consultar o valor FIPE agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {(Object.keys(TIPO_LABELS) as TipoVeiculo[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTipo(t)}
            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium ${
              tipo === t ? "bg-[#0b2545] text-white" : "border border-slate-300 text-slate-500 hover:bg-slate-100"
            }`}
          >
            {TIPO_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <select
          value={marcaId}
          onChange={(e) => handleMarca(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          <option value="">Marca...</option>
          {marcas.map((m) => (
            <option key={m.codigo} value={m.codigo}>
              {m.nome}
            </option>
          ))}
        </select>
        <select
          value={modeloId}
          onChange={(e) => handleModelo(e.target.value)}
          disabled={!marcaId}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs disabled:opacity-50"
        >
          <option value="">Modelo...</option>
          {modelos.map((m) => (
            <option key={m.codigo} value={m.codigo}>
              {m.nome}
            </option>
          ))}
        </select>
        <select
          value={anoId}
          onChange={(e) => handleAno(e.target.value)}
          disabled={!modeloId}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs disabled:opacity-50"
        >
          <option value="">Ano...</option>
          {anos.map((a) => (
            <option key={a.codigo} value={a.codigo}>
              {a.nome}
            </option>
          ))}
        </select>
      </div>
      {loading && <div className="text-xs text-slate-500">Consultando FIPE...</div>}
      {error && <div className="text-xs text-red-600">{error}</div>}
      {result && (
        <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">
          <strong>{result.Valor}</strong> — {result.Marca} {result.Modelo} ({result.AnoModelo})
          {result.MesReferencia && <> · ref. {result.MesReferencia}</>}
        </div>
      )}
    </div>
  );
}
