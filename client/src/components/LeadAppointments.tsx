import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { Appointment, Lead, APPOINTMENT_STATUS_LABELS } from "../lib/types";
import { NewAppointmentForm } from "./NewAppointmentForm";

export function LeadAppointments({ lead }: { lead: Lead }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    const res = await api.get("/appointments", { params: { leadId: lead.id } });
    setAppointments(res.data);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  useEffect(() => {
    socket.on("appointment:created", load);
    socket.on("appointment:updated", load);
    socket.on("appointment:deleted", load);
    return () => {
      socket.off("appointment:created", load);
      socket.off("appointment:updated", load);
      socket.off("appointment:deleted", load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-600">Avaliações agendadas</span>
        <div className="relative">
          <button onClick={() => setShowNew((v) => !v)} className="text-xs font-medium text-slate-900 hover:underline">
            + Agendar
          </button>
          {showNew && <NewAppointmentForm fixedLead={lead} onClose={() => setShowNew(false)} />}
        </div>
      </div>
      {appointments.length === 0 && <div className="text-xs text-slate-500">Nenhuma avaliação agendada</div>}
      {appointments.map((a) => (
        <div key={a.id} className="flex items-center justify-between text-xs">
          <span className="text-slate-500">
            {new Date(a.scheduledAt).toLocaleDateString("pt-BR")} às{" "}
            {new Date(a.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span className="text-slate-500">{APPOINTMENT_STATUS_LABELS[a.status]}</span>
        </div>
      ))}
    </div>
  );
}
