import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, API_HOST } from "../lib/api";
import { socket } from "../lib/socket";
import { leadPhoneLabel, leadTitle } from "../lib/leadDisplay";
import { APPOINTMENT_STATUS_LABELS, AppointmentStatus } from "../lib/types";

// Painel do dia: tudo o que depende do dono, em 4 blocos — responder, decidir, agenda e follow-up.
// O resto (responder, qualificar, agendar, confirmar visita, reengajar parados) a IA faz sozinha.

interface LeadSummary {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  vehicleInfo: string | null;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
}

interface CockpitData {
  whatsappStatus: "DISCONNECTED" | "QR" | "CONNECTING" | "READY";
  needsMe: { count: number; items: { lead: LeadSummary; waitingSince: string; lastMessage: string }[] };
  toDecide: {
    count: number;
    qualifiedWithoutPhotos: number;
    items: (LeadSummary & {
      askingPrice: string | null;
      urgency: string | null;
      notes: string | null;
      score: number;
      photos: { id: string; mimeType: string }[];
      lastPhotoAt: string | null;
    })[];
  };
  agenda: { today: AgendaItem[]; tomorrow: AgendaItem[] };
  followUps: {
    reminders: { id: string; dueAt: string; note: string | null; lead: LeadSummary }[];
    lastWeeklyRunOn: string | null;
  };
}

interface AgendaItem {
  id: string;
  scheduledAt: string;
  status: AppointmentStatus;
  notes: string | null;
  confirmationSentAt: string | null;
  lead: LeadSummary;
}

const WA_LABELS: Record<CockpitData["whatsappStatus"], string> = {
  READY: "Conectado",
  CONNECTING: "Conectando...",
  QR: "Aguardando QR Code",
  DISCONNECTED: "Desconectado",
};

function title(lead: LeadSummary) {
  const t = leadTitle(lead);
  return t === "Sem nome" ? leadPhoneLabel(lead.phone) : t;
}

function fmtWaiting(iso: string) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)}d`;
}

function fmtHour(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function visitPlace(notes: string | null) {
  if (notes?.startsWith("Visita na loja")) return "Na loja";
  if (notes?.startsWith("Avaliação no endereço do lead")) return "No endereço do lead";
  return null;
}

function photoUrl(id: string) {
  return `${API_HOST}/api/attachments/${id}/file`;
}

function isBrowserImage(mimeType: string) {
  return mimeType.startsWith("image/") && !/hei[cf]/i.test(mimeType);
}

function Block({
  n,
  title,
  hint,
  count,
  accent,
  action,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  count?: number;
  accent: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs text-white ${accent}`}>{n}</span>
          {title}
          {count !== undefined && <span className="text-slate-500">({count})</span>}
        </h2>
        {action}
      </div>
      <p className="mb-3 text-xs text-slate-500">{hint}</p>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md bg-slate-50 py-4 text-center text-xs text-slate-500">{children}</div>;
}

function DecideCard({
  lead,
  onDecided,
}: {
  lead: CockpitData["toDecide"]["items"][number];
  onDecided: (message?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  async function decide(interest: boolean) {
    let reason: string | undefined;
    if (!interest) {
      const answer = window.prompt("Motivo (opcional) — ex: ano muito antigo, valor alto, muito batido:", "");
      if (answer === null) return;
      reason = answer || undefined;
    }
    setBusy(true);
    try {
      const res = await api.post(`/cockpit/decide/${lead.id}`, { interest, reason });
      onDecided(res.data.warning);
    } catch {
      setBusy(false);
      alert("Não foi possível registrar a decisão.");
    }
  }

  const images = lead.photos.filter((p) => isBrowserImage(p.mimeType));
  const otherPhotos = lead.photos.length - images.length;

  return (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white">
      <div className="grid grid-cols-4 gap-0.5 overflow-hidden rounded-t-lg bg-slate-100">
        {images.slice(0, 4).map((p) => (
          <button key={p.id} type="button" onClick={() => setViewing(p.id)} className="aspect-square overflow-hidden">
            <img src={photoUrl(p.id)} alt="Foto do veículo" loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
        {images.length === 0 && (
          <div className="col-span-4 py-6 text-center text-xs text-slate-500">
            {otherPhotos > 0 ? `${otherPhotos} foto(s) em formato do iPhone — abra a conversa pra ver` : "Sem fotos"}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3 text-xs">
        <div className="text-sm font-semibold text-slate-900">{title(lead)}</div>
        {lead.vehicleInfo && <div className="text-slate-600">🚗 {lead.vehicleInfo}</div>}
        {lead.askingPrice && <div className="font-medium text-emerald-700">💰 Quer {lead.askingPrice}</div>}
        {lead.urgency && <div className="text-slate-600">⏱ {lead.urgency}</div>}
        {lead.notes && <div className="line-clamp-3 text-slate-500">{lead.notes}</div>}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <button
            onClick={() => decide(true)}
            disabled={busy}
            className="flex-1 rounded-md bg-emerald-600 px-2 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            ✅ Tenho interesse
          </button>
          <button
            onClick={() => decide(false)}
            disabled={busy}
            className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            ❌ Sem interesse
          </button>
        </div>
        <Link to={`/inbox?lead=${lead.id}`} className="text-center text-[11px] text-sky-700 hover:underline">
          Ver conversa ({lead.photos.length} foto{lead.photos.length === 1 ? "" : "s"})
        </Link>
      </div>
      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setViewing(null)}
        >
          <img src={photoUrl(viewing)} alt="Foto em tamanho real" className="max-h-full max-w-full rounded-md object-contain" />
        </div>
      )}
    </div>
  );
}

function AgendaList({ items, empty }: { items: AgendaItem[]; empty: string }) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="divide-y divide-slate-100">
      {items.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
          <div className="min-w-0">
            <span className="mr-2 font-semibold tabular-nums text-slate-900">{fmtHour(a.scheduledAt)}</span>
            <Link to={`/inbox?lead=${a.lead.id}`} className="text-slate-800 hover:underline">
              {title(a.lead)}
            </Link>
            {visitPlace(a.notes) && <span className="ml-2 text-xs text-slate-500">{visitPlace(a.notes)}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
            {a.confirmationSentAt && <span className="text-slate-500">confirmação enviada ✓</span>}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{APPOINTMENT_STATUS_LABELS[a.status]}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Rotina() {
  const [data, setData] = useState<CockpitData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reloadTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const res = await api.get("/cockpit");
    setData(res.data);
  }, []);

  // Recarrega quando algo muda (mensagem nova, lead movido, agenda) — com um pequeno atraso pra
  // juntar várias mudanças seguidas numa recarga só — e a cada minuto pros tempos de espera.
  useEffect(() => {
    load();
    const scheduleReload = () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(load, 1500);
    };
    const events = ["message:new", "lead:updated", "conversation:updated", "appointment:created", "appointment:updated", "appointment:deleted", "reminder:created"];
    events.forEach((e) => socket.on(e, scheduleReload));
    const interval = window.setInterval(load, 60_000);
    return () => {
      events.forEach((e) => socket.off(e, scheduleReload));
      window.clearInterval(interval);
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
    };
  }, [load]);

  async function completeReminder(id: string) {
    await api.patch(`/reminders/${id}`, { done: true });
    load();
  }

  if (!data) return <div className="text-sm text-slate-500">Carregando o painel do dia...</div>;

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Painel do dia</h1>
          <p className="text-sm text-slate-500">Só o que depende de você. O resto a IA faz sozinha.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className={`h-2.5 w-2.5 rounded-full ${data.whatsappStatus === "READY" ? "bg-emerald-500" : "bg-red-500"}`} />
          WhatsApp: {WA_LABELS[data.whatsappStatus]}
          {data.whatsappStatus !== "READY" && (
            <Link to="/whatsapp" className="text-sky-700 hover:underline">
              reconectar
            </Link>
          )}
        </div>
      </div>

      {notice && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</div>
      )}

      <Block
        n={1}
        title="Responder agora"
        hint="Leads esperando resposta que a IA não vai dar sozinha — os que esperam há mais tempo primeiro."
        count={data.needsMe.count}
        accent="bg-red-600"
        action={
          data.needsMe.count > 0 && (
            <Link to="/inbox?fila=1" className="rounded-md bg-[#0b2545] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#122f5c]">
              Abrir fila "Precisa de mim"
            </Link>
          )
        }
      >
        {data.needsMe.count === 0 ? (
          <Empty>Ninguém esperando por você agora. 👌</Empty>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.needsMe.items.map((i) => (
              <Link
                key={i.lead.id}
                to={`/inbox?lead=${i.lead.id}`}
                className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">{title(i.lead)}</div>
                  <div className="truncate text-xs text-slate-500">{i.lastMessage}</div>
                </div>
                <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700">
                  ⏳ {fmtWaiting(i.waitingSince)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Block>

      <Block
        n={2}
        title="Para decidir"
        hint="Leads qualificados que já mandaram fotos. Tenho interesse → a IA puxa o agendamento da avaliação na hora. Sem interesse → vai pra Perdido."
        count={data.toDecide.count}
        accent="bg-amber-500"
      >
        {data.toDecide.count === 0 ? (
          <Empty>
            Nenhum lead com fotos esperando decisão.
            {data.toDecide.qualifiedWithoutPhotos > 0 &&
              ` ${data.toDecide.qualifiedWithoutPhotos} qualificado(s) ainda sem fotos — a IA está pedindo.`}
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.toDecide.items.map((lead) => (
                <DecideCard
                  key={lead.id}
                  lead={lead}
                  onDecided={(warning) => {
                    setNotice(warning ?? null);
                    load();
                  }}
                />
              ))}
            </div>
            {data.toDecide.qualifiedWithoutPhotos > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                + {data.toDecide.qualifiedWithoutPhotos} qualificado(s) ainda sem fotos — a IA está pedindo.
              </p>
            )}
          </>
        )}
      </Block>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Block
          n={3}
          title="Agenda"
          hint="Na véspera, a IA confirma a visita com o lead (a partir das 10h). Às 8h você recebe o resumo do dia no WhatsApp."
          accent="bg-emerald-600"
          action={
            <Link to="/agendamentos" className="text-xs text-sky-700 hover:underline">
              Ver agenda completa
            </Link>
          }
        >
          <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Hoje</h3>
          <AgendaList items={data.agenda.today} empty="Nenhuma visita hoje." />
          <h3 className="mb-1 mt-3 text-xs font-semibold uppercase text-slate-500">Amanhã</h3>
          <AgendaList items={data.agenda.tomorrow} empty="Nenhuma visita amanhã." />
        </Block>

        <Block
          n={4}
          title="Follow-up"
          hint="Toda segunda às 10h o CRM reengaja os leads parados há 3+ dias e manda pra Perdido quem ficou 7 dias sem responder depois disso. Você recebe o resumo no WhatsApp."
          count={data.followUps.reminders.length}
          accent="bg-sky-600"
        >
          {data.followUps.reminders.length === 0 ? (
            <Empty>Nenhum lembrete pra hoje.</Empty>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.followUps.reminders.map((r) => {
                const overdue = new Date(r.dueAt) < new Date(new Date().toDateString());
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <Link to={`/inbox?lead=${r.lead.id}`} className="font-medium text-slate-900 hover:underline">
                        {title(r.lead)}
                      </Link>
                      <div className="truncate text-xs text-slate-500">
                        {overdue ? "⚠️ atrasado · " : ""}
                        {r.note || "Retomar contato"}
                      </div>
                    </div>
                    <button
                      onClick={() => completeReminder(r.id)}
                      className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                    >
                      Feito ✓
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-[11px] text-slate-500">
            Última rodada automática: {data.followUps.lastWeeklyRunOn ? data.followUps.lastWeeklyRunOn.split("-").reverse().join("/") : "ainda não rodou"}
          </p>
        </Block>
      </div>
    </div>
  );
}
