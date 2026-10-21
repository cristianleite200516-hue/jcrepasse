import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { Lead, LeadStatus, RESALE_STATUSES, RESALE_STATUS_LABELS, ResaleStatus } from "../lib/types";
import { NewStockForm } from "../components/NewStockForm";

function vehicleLabel(lead: Lead) {
  const parts = [lead.vehicleBrand, lead.vehicleModel, lead.vehicleYear].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return lead.vehicleInfo || "—";
}

function fmtCurrency(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function diasEmEstoque(lead: Lead) {
  const desde = lead.closedAt ? new Date(lead.closedAt) : new Date(lead.updatedAt);
  const ate = lead.soldAt ? new Date(lead.soldAt) : new Date();
  return Math.max(0, Math.floor((ate.getTime() - desde.getTime()) / (24 * 60 * 60 * 1000)));
}

function StockCard({ lead, onDropStatus }: { lead: Lead; onDropStatus: (leadId: string, status: ResaleStatus) => void }) {
  const dias = diasEmEstoque(lead);
  return (
    <Link
      to={`/leads/${lead.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/lead-id", lead.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="block cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md transition-shadow active:cursor-grabbing"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-900">{vehicleLabel(lead)}</span>
        <span className={`text-xs ${dias > 30 ? "text-red-600" : dias > 14 ? "text-amber-600" : "text-slate-500"}`}>
          {dias}d
        </span>
      </div>
      <div className="text-xs text-slate-500">{lead.name || "Sem nome"}</div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-slate-500">
          Compra: {lead.purchasePrice != null ? fmtCurrency(lead.purchasePrice) : "—"}
        </span>
        <span className="font-medium text-emerald-600">
          {lead.salePrice != null ? fmtCurrency(lead.salePrice) : lead.askingPrice || "—"}
        </span>
      </div>
    </Link>
  );
}

function StockColumn({
  status,
  leads,
  onDropStatus,
}: {
  status: ResaleStatus;
  leads: Lead[];
  onDropStatus: (leadId: string, status: ResaleStatus) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const leadId = e.dataTransfer.getData("text/lead-id");
        if (leadId) onDropStatus(leadId, status);
      }}
      className={`flex w-72 shrink-0 flex-col rounded-lg border transition-colors ${
        dragOver ? "border-emerald-500 bg-emerald-500/10" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h3 className="font-semibold text-sm text-slate-600">{RESALE_STATUS_LABELS[status]}</h3>
        <span className="text-xs text-slate-500">{leads.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-2 overflow-y-auto max-h-[70vh] min-h-[80px]">
        {leads.map((l) => (
          <StockCard key={l.id} lead={l} onDropStatus={onDropStatus} />
        ))}
        {leads.length === 0 && <div className="text-xs text-slate-500 text-center py-4">Nenhum carro aqui</div>}
      </div>
    </div>
  );
}

const OWNED_STATUSES: LeadStatus[] = ["GANHO", "FECHADO"];

export function Estoque() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    const res = await api.get("/leads");
    setLeads(res.data.filter((l: Lead) => OWNED_STATUSES.includes(l.status)));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    function onUpdated() {
      load();
    }
    socket.on("lead:updated", onUpdated);
    socket.on("lead:created", onUpdated);
    return () => {
      socket.off("lead:updated", onUpdated);
      socket.off("lead:created", onUpdated);
    };
  }, []);

  async function handleDrop(leadId: string, resaleStatus: ResaleStatus) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.resaleStatus === resaleStatus) return;
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, resaleStatus } : l)));
    try {
      await api.patch(`/leads/${leadId}`, { resaleStatus });
    } catch {
      load();
    }
  }

  const emEstoque = leads.filter((l) => l.resaleStatus !== "VENDIDO");
  const parados = emEstoque.filter((l) => diasEmEstoque(l) > 14).length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-900">Estoque / Revenda</h1>
        <div className="flex items-center gap-3">
          <div className="text-sm text-slate-500">
            {emEstoque.length} carro(s) em estoque
            {parados > 0 && <span className="ml-2 text-amber-600">· {parados} parado(s) há mais de 14 dias</span>}
          </div>
          <div className="relative">
            <button
              onClick={() => setShowNew((v) => !v)}
              className="rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f5c]"
            >
              + Adicionar veículo
            </button>
            {showNew && <NewStockForm onClose={() => setShowNew(false)} />}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Carregando...</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {RESALE_STATUSES.map((status) => (
            <StockColumn
              key={status}
              status={status}
              leads={leads.filter((l) => l.resaleStatus === status)}
              onDropStatus={handleDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}
