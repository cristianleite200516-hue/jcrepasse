import { FormEvent, useState } from "react";
import { api } from "../lib/api";

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

// A lista é atualizada via o evento de socket "lead:created" emitido pelo backend.
export function NewStockForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [vehicleBrand, setVehicleBrand] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!vehicleBrand.trim()) {
      setError("Informe pelo menos a marca");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await api.post("/leads/stock", {
        name: name || undefined,
        vehicleBrand,
        vehicleModel: vehicleModel || undefined,
        vehicleYear: vehicleYear || undefined,
        vehicleColor: vehicleColor || undefined,
        purchasePrice: numOrNull(purchasePrice),
        notes: notes || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível adicionar o veículo");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="absolute right-0 top-10 z-10 w-80 space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
    >
      <div className="text-sm font-semibold text-slate-600">Adicionar veículo ao estoque</div>
      <p className="text-[11px] text-slate-500">
        Pra carros que não vieram de um lead do WhatsApp (leilão, troca, etc).
      </p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Origem/identificação (opcional, ex: Leilão XYZ)"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={vehicleBrand}
          onChange={(e) => setVehicleBrand(e.target.value)}
          placeholder="Marca *"
          required
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          value={vehicleModel}
          onChange={(e) => setVehicleModel(e.target.value)}
          placeholder="Modelo"
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          value={vehicleYear}
          onChange={(e) => setVehicleYear(e.target.value)}
          placeholder="Ano"
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          value={vehicleColor}
          onChange={(e) => setVehicleColor(e.target.value)}
          placeholder="Cor"
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <input
        value={purchasePrice}
        onChange={(e) => setPurchasePrice(e.target.value)}
        placeholder="Valor de compra (R$)"
        inputMode="decimal"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Observações (opcional)"
        rows={2}
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Adicionando..." : "Adicionar"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-500"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
