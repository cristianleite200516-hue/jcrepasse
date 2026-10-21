import { Link, useNavigate } from "react-router-dom";
import { Lead, LeadStatus } from "../lib/types";
import { askingVsFipe, HOME_DDD, leadDdd, leadDisplayPhone, leadTitle } from "../lib/leadDisplay";

const BORDER_COLORS: Partial<Record<LeadStatus, string>> = {
  CONTATADO: "border-l-blue-500",
  QUALIFICADO: "border-l-amber-500",
  PROPOSTA: "border-l-purple-500",
  GANHO: "border-l-green-500",
  FECHADO: "border-l-emerald-500",
  PERDIDO: "border-l-red-500",
};

function fmtAppointment(iso: string) {
  const date = new Date(iso);
  return `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export function LeadCard({ lead }: { lead: Lead }) {
  const borderColor = BORDER_COLORS[lead.status];
  const ddd = leadDdd(lead);
  const fipeDiff = askingVsFipe(lead);
  const navigate = useNavigate();

  return (
    <Link
      to={`/leads/${lead.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/lead-id", lead.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`block cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md transition-shadow active:cursor-grabbing ${
        borderColor ? `border-l-4 ${borderColor}` : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="min-w-0 truncate font-medium text-slate-900" title={leadTitle(lead)}>
          {leadTitle(lead)}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {/* O card inteiro já é um link pro lead, então o atalho pra conversa navega por código */}
          <button
            type="button"
            title="Abrir a conversa deste lead"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigate(`/inbox?lead=${lead.id}`);
            }}
            className="rounded px-1 text-sm leading-none hover:bg-slate-100"
          >
            💬
          </button>
          <span className="text-xs text-slate-500">{lead.score}%</span>
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-sm text-slate-500">
        {ddd && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              ddd === HOME_DDD ? "bg-emerald-500/15 text-emerald-700" : "bg-slate-100 text-slate-500"
            }`}
          >
            DDD {ddd}
          </span>
        )}
        <span className="min-w-0 truncate">{leadDisplayPhone(lead)}</span>
      </div>
      {lead.vehicleInfo && (
        <div className="mt-1 text-xs text-slate-500 line-clamp-2">🚗 {lead.vehicleInfo}</div>
      )}
      {lead.askingPrice && (
        <div className="mt-1 text-xs font-medium text-emerald-600">
          {lead.askingPrice}
          {fipeDiff !== null && (
            <span
              title="Valor pedido comparado à FIPE"
              className={`ml-1.5 rounded px-1 py-0.5 text-[10px] font-semibold ${
                fipeDiff <= -10 ? "bg-emerald-500/15 text-emerald-700" : fipeDiff <= 5 ? "bg-slate-100 text-slate-600" : "bg-red-500/15 text-red-700"
              }`}
            >
              {fipeDiff > 0 ? "+" : ""}
              {fipeDiff}% FIPE
            </span>
          )}
        </div>
      )}
      {lead.nextAppointment && (
        <div className="mt-1.5 inline-block rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-700">
          📅 {fmtAppointment(lead.nextAppointment.scheduledAt)}
        </div>
      )}
    </Link>
  );
}
