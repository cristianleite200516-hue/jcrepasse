import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { LeadWithConversation, LEAD_STATUSES, STATUS_LABELS } from "../lib/types";
import { ConversationPanel } from "../components/ConversationPanel";
import { StatusBadge } from "../components/StatusBadge";
import { LeadEditPanel } from "../components/LeadEditPanel";
import { LeadAppointments } from "../components/LeadAppointments";
import { LeadReminders } from "../components/LeadReminders";
import { LeadDocuments } from "../components/LeadDocuments";
import { LeadAuditLog } from "../components/LeadAuditLog";
import { AttachmentsPanel } from "../components/AttachmentsPanel";
import { AdGenerator } from "../components/AdGenerator";

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [lead, setLead] = useState<LeadWithConversation | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get(`/leads/${id}`).then((res) => setLead(res.data));
  }, [id]);

  useEffect(() => {
    function onLeadUpdated(updated: LeadWithConversation) {
      if (updated.id !== id) return;
      setLead((prev) => (prev ? { ...prev, ...updated } : prev));
    }
    socket.on("lead:updated", onLeadUpdated);
    return () => {
      socket.off("lead:updated", onLeadUpdated);
    };
  }, [id]);

  async function changeStatus(status: string) {
    if (!lead) return;
    const body: Record<string, unknown> = { status };
    if (status === "PERDIDO") {
      const reason = window.prompt("Motivo da perda (ex: preço, concorrência, desistiu):", lead.lossReason ?? "");
      if (reason === null) return; // cancelou
      body.lossReason = reason || null;
    }
    const res = await api.patch(`/leads/${lead.id}`, body);
    setLead((prev) => (prev ? { ...prev, ...res.data } : prev));
  }

  async function changeScore(score: number) {
    if (!lead) return;
    const res = await api.patch(`/leads/${lead.id}`, { score });
    setLead((prev) => (prev ? { ...prev, ...res.data } : prev));
  }

  if (!id) return null;

  return (
    <div>
      <Link to="/" className="text-sm text-slate-500 hover:underline">
        ← Voltar
      </Link>
      <div className="mt-2 grid grid-cols-3 gap-4">
        <div className="col-span-2 h-[75vh] rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
          <ConversationPanel leadId={id} onDeleted={() => navigate("/")} />
        </div>

        <div className="col-span-1 h-[75vh] space-y-3 overflow-y-auto pr-1">
          {lead && (
            <>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-600">Status</span>
                  <StatusBadge status={lead.status} />
                </div>
                <select
                  value={lead.status}
                  onChange={(e) => changeStatus(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                {lead.status === "PERDIDO" && lead.lossReason && (
                  <div className="mt-2 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-600">
                    Motivo da perda: {lead.lossReason}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  <span>Pontuação:</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={lead.score}
                    onChange={(e) => changeScore(Number(e.target.value))}
                    className="w-16 rounded-md border border-slate-300 px-1.5 py-0.5 text-xs"
                  />
                  <span>%</span>
                </div>
                {lead.vehicleInfo && (
                  <div className="mt-2 text-xs text-slate-500">
                    <span className="font-semibold">Resumo da IA:</span> {lead.vehicleInfo}
                  </div>
                )}
              </div>

              <LeadAppointments lead={lead} />

              <LeadReminders lead={lead} />

              <LeadDocuments
                lead={lead}
                onUpdated={(updated) => setLead((prev) => (prev ? { ...prev, ...updated } : prev))}
              />

              <LeadAuditLog leadId={lead.id} />

              <AttachmentsPanel leadId={lead.id} />

              <AdGenerator lead={lead} />

              <LeadEditPanel lead={lead} onUpdated={(updated) => setLead((prev) => (prev ? { ...prev, ...updated } : prev))} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
