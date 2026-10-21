import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { Reminder, Lead } from "../lib/types";
import { NewReminderForm } from "./NewReminderForm";

export function LeadReminders({ lead }: { lead: Lead }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    const res = await api.get("/reminders", { params: { leadId: lead.id } });
    setReminders(res.data);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

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
  }, [lead.id]);

  async function toggleDone(r: Reminder) {
    await api.patch(`/reminders/${r.id}`, { done: !r.done });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-600">Lembretes de retorno</span>
        <div className="relative">
          <button onClick={() => setShowNew((v) => !v)} className="text-xs font-medium text-slate-900 hover:underline">
            + Lembrete
          </button>
          {showNew && <NewReminderForm fixedLead={lead} onClose={() => setShowNew(false)} />}
        </div>
      </div>
      {reminders.length === 0 && <div className="text-xs text-slate-500">Nenhum lembrete criado</div>}
      {reminders.map((r) => {
        const overdue = !r.done && new Date(r.dueAt).getTime() < Date.now();
        return (
          <div key={r.id} className="flex items-start justify-between gap-2 text-xs">
            <label className="flex flex-1 items-start gap-2">
              <input type="checkbox" checked={r.done} onChange={() => toggleDone(r)} className="mt-0.5" />
              <span className={r.done ? "text-slate-500 line-through" : overdue ? "text-red-600" : "text-slate-600"}>
                {new Date(r.dueAt).toLocaleDateString("pt-BR")} às{" "}
                {new Date(r.dueAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                {r.note ? ` — ${r.note}` : ""}
              </span>
            </label>
          </div>
        );
      })}
    </div>
  );
}
