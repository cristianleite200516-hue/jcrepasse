import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { socket } from "../lib/socket";
import { KanbanColumn } from "../components/KanbanColumn";
import { NewLeadForm } from "../components/NewLeadForm";
import { DailyPanel } from "../components/DailyPanel";
import { Lead, LeadStatus, LEAD_STATUSES, STATUS_LABELS } from "../lib/types";
import { downloadCsv } from "../lib/csv";
import { HOME_DDD, leadDdd } from "../lib/leadDisplay";

type SortMode = "recentes" | "pontuacao" | "antigos";

export function Dashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [showNewLead, setShowNewLead] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("recentes");
  const [assignedFilter, setAssignedFilter] = useState("");
  // "" = todos, "none" = sem DDD conhecido, senão o DDD ("41", "11"...)
  const [dddFilter, setDddFilter] = useState("");
  const [homeFirst, setHomeFirst] = useState(true);
  const navigate = useNavigate();

  // Abre as Conversas já filtradas pelos leads novos (e pelo DDD escolhido aqui), em modo sequência:
  // manda a mensagem e o próximo abre sozinho, sem voltar pro funil.
  function startCalling() {
    const params = new URLSearchParams({ status: "NOVO", seq: "1" });
    if (dddFilter) params.set("ddd", dddFilter);
    if (!homeFirst) params.set("primeiro", "0");
    navigate(`/inbox?${params}`);
  }
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [brand, setBrand] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const advancedActive = !!(brand || minValue || maxValue || dateFrom || dateTo);

  async function load() {
    setLoading(true);
    const res = await api.get("/leads", {
      params: {
        ...(query ? { q: query } : {}),
        ...(brand ? { brand } : {}),
        ...(minValue ? { minValue } : {}),
        ...(maxValue ? { maxValue } : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
      },
    });
    setLeads(res.data);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, brand, minValue, maxValue, dateFrom, dateTo]);

  function clearAdvanced() {
    setBrand("");
    setMinValue("");
    setMaxValue("");
    setDateFrom("");
    setDateTo("");
  }

  useEffect(() => {
    api.get("/auth/team").then((res) => setTeam(res.data));
  }, []);

  useEffect(() => {
    function onCreated(lead: Lead) {
      setLeads((prev) => [lead, ...prev]);
    }
    function onUpdated(lead: Lead) {
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? lead : l)));
    }
    // O servidor descobriu o número real (e o DDD) de leads @lid
    function onPhonesUpdated() {
      load();
    }
    socket.on("lead:created", onCreated);
    socket.on("lead:updated", onUpdated);
    socket.on("leads:phones-updated", onPhonesUpdated);
    return () => {
      socket.off("lead:created", onCreated);
      socket.off("lead:updated", onUpdated);
      socket.off("leads:phones-updated", onPhonesUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDropLead(leadId: string, status: LeadStatus) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === status) return;

    const body: Record<string, unknown> = { status };
    if (status === "PERDIDO") {
      const reason = window.prompt("Motivo da perda (ex: preço, concorrência, desistiu):", "");
      if (reason === null) return; // cancelou, não move o card
      body.lossReason = reason || null;
    }

    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, status } : l)));
    try {
      await api.patch(`/leads/${leadId}`, body);
    } catch {
      load();
    }
  }

  const dddCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of leads) {
      const ddd = leadDdd(l) ?? "none";
      counts.set(ddd, (counts.get(ddd) ?? 0) + 1);
    }
    return counts;
  }, [leads]);

  const otherDdds = useMemo(
    () => [...dddCounts.keys()].filter((d) => d !== HOME_DDD && d !== "none").sort(),
    [dddCounts]
  );

  const visibleLeads = useMemo(() => {
    let result = leads;
    if (dddFilter) {
      result = result.filter((l) => (leadDdd(l) ?? "none") === dddFilter);
    }
    if (assignedFilter === "unassigned") {
      result = result.filter((l) => !l.assignedToId);
    } else if (assignedFilter) {
      result = result.filter((l) => l.assignedToId === assignedFilter);
    }
    result = [...result];
    if (sortMode === "pontuacao") {
      result.sort((a, b) => b.score - a.score);
    } else if (sortMode === "antigos") {
      result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else {
      result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    if (homeFirst) {
      // sort estável: dentro de cada grupo mantém a ordenação escolhida acima
      const isHome = (l: Lead) => (leadDdd(l) === HOME_DDD ? 0 : 1);
      result.sort((a, b) => isHome(a) - isHome(b));
    }
    return result;
  }, [leads, assignedFilter, sortMode, dddFilter, homeFirst]);

  function handleExport() {
    downloadCsv(
      `leads-${new Date().toISOString().slice(0, 10)}.csv`,
      visibleLeads.map((l) => ({
        Nome: l.name || "",
        Telefone: l.phone,
        TelefoneReal: l.phone2 || "",
        DDD: leadDdd(l) || "",
        Status: STATUS_LABELS[l.status],
        Pontuacao: l.score,
        Marca: l.vehicleBrand || "",
        Modelo: l.vehicleModel || "",
        Ano: l.vehicleYear || "",
        KM: l.vehicleKm ?? "",
        ValorPretendido: l.askingPrice || "",
        ValorFipe: l.fipeValue || "",
        ValorCompra: l.purchasePrice ?? "",
        ValorVenda: l.salePrice ?? "",
        Responsavel: l.assignedTo?.name || "",
        CriadoEm: new Date(l.createdAt).toLocaleDateString("pt-BR"),
      }))
    );
  }

  return (
    <div>
      <DailyPanel />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-slate-900">Funil de leads</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou telefone..."
            className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="recentes">Mais recentes</option>
            <option value="pontuacao">Maior pontuação</option>
            <option value="antigos">Mais antigos</option>
          </select>
          <select
            value={assignedFilter}
            onChange={(e) => setAssignedFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Todos os responsáveis</option>
            <option value="unassigned">Sem responsável</option>
            {team.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={dddFilter}
            onChange={(e) => setDddFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Todos os DDDs</option>
            <option value={HOME_DDD}>
              DDD {HOME_DDD} — minha região ({dddCounts.get(HOME_DDD) ?? 0})
            </option>
            {otherDdds.map((d) => (
              <option key={d} value={d}>
                DDD {d} ({dddCounts.get(d)})
              </option>
            ))}
            <option value="none">DDD desconhecido ({dddCounts.get("none") ?? 0})</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={homeFirst} onChange={(e) => setHomeFirst(e.target.checked)} />
            DDD {HOME_DDD} primeiro
          </label>
          <button
            onClick={startCalling}
            title="Abre as Conversas só com os leads Novos (e o DDD escolhido); ao enviar, já abre o próximo"
            className="rounded-md border border-emerald-500 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-500/20"
          >
            💬 Chamar leads novos
          </button>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              advancedActive
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-600"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            Busca avançada{advancedActive ? " ●" : ""}
          </button>
          <button
            onClick={handleExport}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Exportar CSV
          </button>
          <div className="relative">
            <button
              onClick={() => setShowNewLead((v) => !v)}
              className="rounded-md bg-[#0b2545] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#122f5c]"
            >
              + Novo lead
            </button>
            {showNewLead && <NewLeadForm onClose={() => setShowNewLead(false)} />}
          </div>
        </div>
      </div>
      {showAdvanced && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <label className="block text-[11px] text-slate-500">Marca</label>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="ex: Fiat"
              className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500">Valor de compra mín. (R$)</label>
            <input
              value={minValue}
              onChange={(e) => setMinValue(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0"
              inputMode="decimal"
              className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500">Valor de compra máx. (R$)</label>
            <input
              value={maxValue}
              onChange={(e) => setMaxValue(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="999999"
              inputMode="decimal"
              className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500">Criado de</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500">Criado até</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          {advancedActive && (
            <button
              onClick={clearAdvanced}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}
      {loading ? (
        <div className="text-sm text-slate-500">Carregando...</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {LEAD_STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              leads={visibleLeads.filter((l) => l.status === status)}
              onDropLead={handleDropLead}
            />
          ))}
        </div>
      )}
    </div>
  );
}
