import { FormEvent, useState } from "react";
import { api } from "../lib/api";

export function NewUserForm({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "AGENT">("AGENT");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post("/auth/users", { name, email, password, role });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Não foi possível criar o usuário");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-slate-600">Novo usuário</div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome"
        required
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="E-mail"
        required
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Senha (mínimo 6 caracteres)"
        minLength={6}
        required
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as "ADMIN" | "AGENT")}
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      >
        <option value="AGENT">Agente</option>
        <option value="ADMIN">Administrador</option>
      </select>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f5c] disabled:opacity-50"
        >
          {saving ? "Criando..." : "Criar usuário"}
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
