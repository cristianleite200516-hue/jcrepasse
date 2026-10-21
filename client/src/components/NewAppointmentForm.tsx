import { FormEvent, useState } from "react";
import { api } from "../lib/api";
import { Lead } from "../lib/types";
import { LeadPicker } from "./LeadPicker";

export function NewAppointmentForm({ fixedLead, onClose }: { fixedLead?: Lead; onClose: () => void }) {
  const [lead, setLead] = useState<Lead | null>(fixedLead ?? null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!lead) {
      setError("Selecione um lead");
      return;
    }
    if (!date) {
      setError("Selecione uma data");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const scheduledAt = new Date(`${date}T${time}:00`).toISOString();
      await api.post("/appointments", { leadId: lead.id, scheduledAt, notes: notes || undefined });
      onClose();
    } catch {
      setError("Não foi possível criar o agendamento");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="absolute right-0 top-10 z-10 w-80 space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
    >
      <div className="text-sm font-semibold text-slate-600">Agendar avaliação</div>
      {!fixedLead && <LeadPicker onSelect={setLead} />}
      {fixedLead && (
        <div className="rounded-md bg-slate-50 px-2 py-1.5 text-sm text-slate-600">
          {fixedLead.name || "Sem nome"} — {fixedLead.phone}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
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
          {saving ? "Agendando..." : "Agendar"}
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
