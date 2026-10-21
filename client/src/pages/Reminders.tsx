import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { Reminder } from "../lib/types";
import { NewReminderForm } from "../components/NewReminderForm";

function vehicleLabel(lead: Reminder["lead"]) {
  const parts = [lead.vehicleBrand, lead.vehicleModel, lead.vehicleYear].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return lead.vehicleInfo || "—";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function Reminders() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    const res = await api.get("/reminders", { params: { status: showDone ? "done" : "pending" } });
    setReminders(res.data);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDone]);

  useEffect(() => {
    socket.on("reminder:created", load);
    socket.on("reminder:updated", load);
    socket.on("reminder:deleted", load);
    return () => {
      socket.off("reminder:created", load);
      socket.off("reminder:updated", load);
      socket.off("reminder:deleted", load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDone]);

  async function toggleDone(r: Reminder) {
    await api.patch(`/reminders/${r.id}`, { done: !r.done });
  }

  async function remove(id: string) {
    if (!confirm("Excluir este lembrete?")) return;
    await api.delete(`/reminders/${id}`);
  }

  const now = Date.now();

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-900">Lembretes de retorno</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDone((v) => !v)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            {showDone ? "Ver pendentes" : "Ver concluídos"}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowNew((v) => !v)}
              className="rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f5c]"
            >
              + Novo lembrete
            </button>
            {showNew && <NewReminderForm onClose={() => setShowNew(false)} />}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Carregando...</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Dia</th>
                <th className="px-4 py-2">Horário</th>
                <th className="px-4 py-2">Lead</th>
                <th className="px-4 py-2">Modelo</th>
                <th className="px-4 py-2">Anotação</th>
                <th className="px-4 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {reminders.map((r) => {
                const overdue = !r.done && new Date(r.dueAt).getTime() < now;
                return (
                  <tr key={r.id} className="border-t border-slate-200">
                    <td className={`px-4 py-2 whitespace-nowrap ${overdue ? "text-red-600 font-medium" : ""}`}>
                      {fmtDate(r.dueAt)}
                      {overdue && " (atrasado)"}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{fmtTime(r.dueAt)}</td>
                    <td className="px-4 py-2">
                      <Link to={`/leads/${r.leadId}`} className="text-slate-900 hover:underline">
                        {r.lead.name || "Sem nome"}
                      </Link>
                      <div className="text-xs text-slate-500">{r.lead.phone}</div>
                    </td>
                    <td className="px-4 py-2">{vehicleLabel(r.lead)}</td>
                    <td className="px-4 py-2 text-slate-500">{r.note || "—"}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2 text-xs">
                        <button onClick={() => toggleDone(r)} className="text-emerald-600 hover:underline">
                          {r.done ? "Reabrir" : "Concluir"}
                        </button>
                        <button onClick={() => remove(r.id)} className="text-red-600 hover:underline">
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {reminders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    {showDone ? "Nenhum lembrete concluído" : "Nenhum lembrete pendente"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
