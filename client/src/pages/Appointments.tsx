import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { Appointment, AppointmentStatus, APPOINTMENT_STATUS_LABELS } from "../lib/types";
import { NewAppointmentForm } from "../components/NewAppointmentForm";
import { downloadCsv } from "../lib/csv";
import { useAuth } from "../lib/auth";
import { HOME_DDD, leadDdd } from "../lib/leadDisplay";

function vehicleLabel(lead: Appointment["lead"]) {
  const parts = [lead.vehicleBrand, lead.vehicleModel, lead.vehicleYear].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return lead.vehicleInfo || "—";
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR");
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtWeekday(iso: string) {
  const d = new Date(iso);
  const label = d.toLocaleDateString("pt-BR", { weekday: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  AGENDADO: "bg-slate-100 text-slate-600",
  CONFIRMADO: "bg-blue-500/15 text-blue-700",
  REALIZADO: "bg-emerald-500/15 text-emerald-600",
  CANCELADO: "bg-red-500/15 text-red-600",
};

const WEEKDAY_LABELS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const GRID_HOURS = Array.from({ length: 12 }, (_, i) => 8 + i); // 08h às 19h

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=dom .. 6=sáb
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtShortDate(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function WeekGrid({ appointments }: { appointments: Appointment[] }) {
  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = new Date(startOfWeek(new Date()));
  weekStart.setDate(weekStart.getDate() + weekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const inWeek = appointments.filter((a) => {
    const t = new Date(a.scheduledAt).getTime();
    return t >= weekStart.getTime() && t < weekEnd.getTime();
  });

  function appointmentsAt(dayIdx: number, hour: number) {
    return inWeek.filter((a) => {
      const d = new Date(a.scheduledAt);
      const dow = d.getDay() === 0 ? 6 : d.getDay() - 1; // segunda=0 ... domingo=6
      return dow === dayIdx && d.getHours() === hour;
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => setWeekOffset((v) => v - 1)}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
        >
          ← Semana anterior
        </button>
        <div className="text-sm font-medium text-slate-800">
          {fmtShortDate(weekDays[0])} – {fmtShortDate(weekDays[6])}
          {weekOffset !== 0 && (
            <button onClick={() => setWeekOffset(0)} className="ml-2 text-xs text-emerald-600 hover:underline">
              (voltar pra hoje)
            </button>
          )}
        </div>
        <button
          onClick={() => setWeekOffset((v) => v + 1)}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
        >
          Semana seguinte →
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="w-16 border border-slate-200 bg-slate-50 px-2 py-2 text-slate-500">Hora</th>
              {weekDays.map((d, i) => {
                const isToday = d.toDateString() === new Date().toDateString();
                return (
                  <th
                    key={i}
                    className={`border border-slate-200 px-2 py-2 ${isToday ? "bg-emerald-500/10 text-emerald-700" : "bg-slate-50 text-slate-600"}`}
                  >
                    {WEEKDAY_LABELS[i]}
                    <div className="font-normal text-slate-500">{fmtShortDate(d)}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {GRID_HOURS.map((hour) => (
              <tr key={hour}>
                <td className="border border-slate-200 bg-slate-50 px-2 py-2 text-center text-slate-500">
                  {String(hour).padStart(2, "0")}:00
                </td>
                {weekDays.map((_, dayIdx) => {
                  const items = appointmentsAt(dayIdx, hour);
                  return (
                    <td key={dayIdx} className="border border-slate-200 px-1 py-1 align-top">
                      <div className="flex flex-col gap-1">
                        {items.map((a) => (
                          <Link
                            key={a.id}
                            to={`/leads/${a.leadId}`}
                            className={`block rounded px-1.5 py-1 leading-tight hover:opacity-80 ${STATUS_COLORS[a.status]}`}
                            title={vehicleLabel(a.lead)}
                          >
                            <div className="font-medium">{fmtTime(a.scheduledAt)}</div>
                            <div className="truncate">{a.lead.name || a.lead.phone}</div>
                          </Link>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface TzFixItem {
  id: string;
  leadName: string | null;
  leadPhone: string;
  vehicleInfo: string | null;
  status: AppointmentStatus;
  notes: string | null;
  currentAt: string;
  correctedAt: string;
}

function fmtFull(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Visitas que a IA agendou antes da correção de fuso ficaram gravadas 3h antes do combinado. Só
// aparece (pra admin) enquanto houver alguma pra corrigir; mostra a lista e só aplica ao confirmar.
function AppointmentTzFixBanner() {
  const [items, setItems] = useState<TzFixItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/appointments/tz-fix/preview")
      .then((res) => setItems(res.data))
      .catch(() => setItems([]));
  }, []);

  async function apply() {
    if (!items || !confirm(`Somar 3h no horário de ${items.length} visita(s) agendada(s) pela IA?`)) return;
    setApplying(true);
    try {
      const res = await api.post("/appointments/tz-fix");
      setResult(`${res.data.fixed} visita(s) corrigida(s).`);
      setItems([]);
    } catch {
      setResult("Não foi possível corrigir os horários.");
    } finally {
      setApplying(false);
    }
  }

  if (result) {
    return <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{result}</div>;
  }
  if (!items || items.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-amber-900">
          ⚠️ {items.length} visita(s) agendada(s) pela IA estão com o horário 3h adiantado (bug de fuso já corrigido).
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          {open ? "Esconder" : "Ver e corrigir"}
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="max-h-72 overflow-y-auto rounded-md border border-amber-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-amber-50 text-left text-amber-900">
                <tr>
                  <th className="px-2 py-1">Lead</th>
                  <th className="px-2 py-1">Hoje está</th>
                  <th className="px-2 py-1">Fica</th>
                  <th className="px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-t border-amber-100">
                    <td className="px-2 py-1">
                      {[i.leadName, i.vehicleInfo?.split(",")[0]].filter(Boolean).join(" · ") || i.leadPhone}
                    </td>
                    <td className="px-2 py-1 text-slate-500 line-through">{fmtFull(i.currentAt)}</td>
                    <td className="px-2 py-1 font-medium text-slate-900">{fmtFull(i.correctedAt)}</td>
                    <td className="px-2 py-1">{APPOINTMENT_STATUS_LABELS[i.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={apply}
            disabled={applying}
            className="rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f5c] disabled:opacity-50"
          >
            {applying ? "Corrigindo..." : `Corrigir ${items.length} visita(s)`}
          </button>
        </div>
      )}
    </div>
  );
}

interface DedupeGroup {
  leadId: string;
  leadName: string | null;
  leadPhone: string;
  vehicleInfo: string | null;
  keep: { id: string; scheduledAt: string; status: AppointmentStatus };
  cancel: { id: string; scheduledAt: string; status: AppointmentStatus; reason: "MESMO_HORARIO" | "REMARCADO" }[];
}

// Só admin: agendamentos duplicados que a IA criou (mesmo horário repetido ou remarcação que deixou o antigo
// aberto). Mostra o que fica e o que será cancelado; cancelar não apaga nada.
function AppointmentDedupeBanner() {
  const [groups, setGroups] = useState<DedupeGroup[] | null>(null);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    api.get("/appointments/dedupe/preview").then((res) => setGroups(res.data)).catch(() => setGroups([]));
  }, []);

  const total = (groups ?? []).reduce((n, g) => n + g.cancel.length, 0);

  async function apply() {
    if (!confirm(`Cancelar ${total} agendamento(s) duplicado(s) de ${groups?.length} lead(s)? Os cancelados continuam no histórico.`)) return;
    setApplying(true);
    try {
      const res = await api.post("/appointments/dedupe");
      setResult(`${res.data.cancelled} duplicado(s) cancelado(s).`);
      setGroups([]);
    } catch {
      setResult("Não foi possível limpar os duplicados.");
    } finally {
      setApplying(false);
    }
  }

  if (result) {
    return <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{result}</div>;
  }
  if (!groups || groups.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-amber-900">
          ⚠️ {total} agendamento(s) duplicado(s) de {groups.length} lead(s) criados pela IA.
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          {open ? "Esconder" : "Ver e limpar"}
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="max-h-72 overflow-y-auto rounded-md border border-amber-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-amber-50 text-left text-amber-900">
                <tr>
                  <th className="px-2 py-1">Lead</th>
                  <th className="px-2 py-1">Fica</th>
                  <th className="px-2 py-1">Cancela</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.leadId} className="border-t border-amber-100 align-top">
                    <td className="px-2 py-1">
                      {[g.leadName, g.vehicleInfo?.split(",")[0]].filter(Boolean).join(" · ") || g.leadPhone}
                    </td>
                    <td className="px-2 py-1 font-medium text-slate-900">
                      {fmtDate(g.keep.scheduledAt)} {fmtTime(g.keep.scheduledAt)}
                    </td>
                    <td className="px-2 py-1 text-slate-500">
                      {g.cancel.map((c) => (
                        <div key={c.id}>
                          {fmtDate(c.scheduledAt)} {fmtTime(c.scheduledAt)} ({c.reason === "MESMO_HORARIO" ? "repetido" : "remarcado"})
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={apply}
            disabled={applying}
            className="rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f5c] disabled:opacity-50"
          >
            {applying ? "Cancelando..." : `Cancelar ${total} duplicado(s)`}
          </button>
        </div>
      )}
    </div>
  );
}

// "Onde" da avaliação, lido da observação que a IA grava ("Avaliação no endereço do lead..." / "Visita na loja...").
function appointmentPlace(notes: string | null): "casa" | "loja" | null {
  if (!notes) return null;
  if (/^avalia[cç][aã]o no endere[cç]o|^avaliar em /i.test(notes)) return "casa";
  if (/^visita na loja/i.test(notes)) return "loja";
  return null;
}

export function Appointments() {
  const { user } = useAuth();
  const [placeFilter, setPlaceFilter] = useState<"" | "casa" | "loja">("");
  const [dddFilter, setDddFilter] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState<"lista" | "semana">("semana");

  async function load() {
    setLoading(true);
    const res = await api.get("/appointments");
    setAppointments(res.data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    socket.on("appointment:created", load);
    socket.on("appointment:updated", load);
    socket.on("appointment:deleted", load);
    return () => {
      socket.off("appointment:created", load);
      socket.off("appointment:updated", load);
      socket.off("appointment:deleted", load);
    };
  }, []);

  const allAppointments = appointments;
  const dddCounts = new Map<string, number>();
  for (const a of allAppointments) {
    const d = leadDdd(a.lead as typeof a.lead & { phone2?: string | null; areaCode?: string | null }) ?? "none";
    dddCounts.set(d, (dddCounts.get(d) ?? 0) + 1);
  }
  const dddOptions = [...dddCounts.entries()].sort((a, b) =>
    a[0] === HOME_DDD ? -1 : b[0] === HOME_DDD ? 1 : b[1] - a[1]
  );
  const visible = allAppointments.filter((a) => {
    if (placeFilter && appointmentPlace(a.notes) !== placeFilter) return false;
    if (dddFilter) {
      const d = leadDdd(a.lead as typeof a.lead & { phone2?: string | null; areaCode?: string | null }) ?? "none";
      if (d !== dddFilter) return false;
    }
    return true;
  });

  async function updateStatus(id: string, status: AppointmentStatus) {
    await api.patch(`/appointments/${id}`, { status });
  }

  async function remove(id: string) {
    if (!confirm("Cancelar este agendamento?")) return;
    await api.delete(`/appointments/${id}`);
  }

  function handleExport() {
    downloadCsv(
      `agendamentos-${new Date().toISOString().slice(0, 10)}.csv`,
      visible.map((a) => ({
        DiaDaSemana: fmtWeekday(a.scheduledAt),
        Data: fmtDate(a.scheduledAt),
        Horario: fmtTime(a.scheduledAt),
        Lead: a.lead.name || "Sem nome",
        Telefone: a.lead.phone,
        Veiculo: vehicleLabel(a.lead),
        Status: APPOINTMENT_STATUS_LABELS[a.status],
        Observacoes: a.notes || "",
      }))
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-900">Agendamento de avaliações</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-slate-300 p-0.5">
            <button
              onClick={() => setView("semana")}
              className={`rounded px-2.5 py-1 text-xs font-medium ${view === "semana" ? "bg-[#0b2545] text-white" : "text-slate-500 hover:text-slate-800"}`}
            >
              Semana
            </button>
            <button
              onClick={() => setView("lista")}
              className={`rounded px-2.5 py-1 text-xs font-medium ${view === "lista" ? "bg-[#0b2545] text-white" : "text-slate-500 hover:text-slate-800"}`}
            >
              Lista
            </button>
          </div>
          <button
            onClick={handleExport}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Exportar CSV
          </button>
          <div className="relative">
            <button
              onClick={() => setShowNew((v) => !v)}
              className="rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f5c]"
            >
              + Novo agendamento
            </button>
            {showNew && <NewAppointmentForm onClose={() => setShowNew(false)} />}
          </div>
        </div>
      </div>

      {user?.role === "ADMIN" && <AppointmentTzFixBanner />}
      {user?.role === "ADMIN" && <AppointmentDedupeBanner />}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={placeFilter}
          onChange={(e) => setPlaceFilter(e.target.value as "" | "casa" | "loja")}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">Casa e loja</option>
          <option value="casa">Avaliação em casa</option>
          <option value="loja">Visita na loja</option>
        </select>
        <select
          value={dddFilter}
          onChange={(e) => setDddFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          <option value="">Todos os DDDs</option>
          {dddOptions.map(([d, n]) => (
            <option key={d} value={d}>
              {d === "none" ? "DDD desconhecido" : `DDD ${d}`} ({n})
            </option>
          ))}
        </select>
        {(placeFilter || dddFilter) && (
          <span className="text-xs text-slate-500">
            {visible.length} de {allAppointments.length} agendamento(s)
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Carregando...</div>
      ) : view === "semana" ? (
        <WeekGrid appointments={visible} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Dia da semana</th>
                <th className="px-4 py-2">Dia</th>
                <th className="px-4 py-2">Horário</th>
                <th className="px-4 py-2">Lead</th>
                <th className="px-4 py-2">Modelo</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Observações</th>
                <th className="px-4 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id} className="border-t border-slate-200">
                  <td className="px-4 py-2 whitespace-nowrap">{fmtWeekday(a.scheduledAt)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDate(a.scheduledAt)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{fmtTime(a.scheduledAt)}</td>
                  <td className="px-4 py-2">
                    <Link to={`/leads/${a.leadId}`} className="text-slate-900 hover:underline">
                      {a.lead.name || "Sem nome"}
                    </Link>
                    <div className="text-xs text-slate-500">{a.lead.phone}</div>
                  </td>
                  <td className="px-4 py-2">{vehicleLabel(a.lead)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[a.status]}`}>
                      {APPOINTMENT_STATUS_LABELS[a.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{a.notes || "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2 text-xs">
                      {a.status !== "REALIZADO" && a.status !== "CANCELADO" && (
                        <>
                          {a.status === "AGENDADO" && (
                            <button
                              onClick={() => updateStatus(a.id, "CONFIRMADO")}
                              className="text-blue-600 hover:underline"
                            >
                              Confirmar
                            </button>
                          )}
                          <button
                            onClick={() => updateStatus(a.id, "REALIZADO")}
                            className="text-emerald-600 hover:underline"
                          >
                            Concluir
                          </button>
                          <button onClick={() => remove(a.id)} className="text-red-600 hover:underline">
                            Cancelar
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                    {appointments.length === 0 ? "Nenhum agendamento ainda" : "Nenhum agendamento nesse filtro"}
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
