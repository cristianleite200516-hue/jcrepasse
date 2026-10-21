import { FormEvent, useState } from "react";
import { api } from "../lib/api";
import { CepLookup } from "./CepLookup";

// A lista de leads é atualizada via o evento de socket "lead:created" emitido pelo
// backend ao criar — este formulário não precisa (e não deve) atualizar o estado local.
export function NewLeadForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post("/leads", {
        name: name || undefined,
        phone: phone.replace(/\D/g, ""),
        email: email || undefined,
        address: address || undefined,
        city: city || undefined,
        state: state || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível criar o lead");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="absolute right-0 top-10 z-10 w-80 space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
    >
      <div className="text-sm font-semibold text-slate-600">Novo lead</div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Telefone (com DDD)"
        required
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="E-mail (opcional)"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <CepLookup
        onFound={(result) => {
          setAddress(result.address ?? address);
          setCity(result.city ?? city);
          setState(result.state ?? state);
        }}
      />
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Endereço"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <div className="flex gap-2">
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Cidade"
          className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          value={state}
          onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
          placeholder="UF"
          maxLength={2}
          className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Criando..." : "Criar"}
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
