import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { Lead, LEAD_CHANNELS, CHANNEL_LABELS } from "../lib/types";
import { FipeLookup } from "./FipeLookup";
import { CepLookup } from "./CepLookup";
import { maskCurrency, useHideMoney } from "../lib/useHideMoney";

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

function fmtCurrency(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function LeadEditPanel({ lead, onUpdated }: { lead: Lead; onUpdated: (lead: Lead) => void }) {
  const { hidden } = useHideMoney();
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    name: lead.name ?? "",
    phone: lead.phone ?? "",
    assignedToId: lead.assignedToId ?? "",
    email: lead.email ?? "",
    address: lead.address ?? "",
    city: lead.city ?? "",
    state: lead.state ?? "",
    vehicleBrand: lead.vehicleBrand ?? "",
    vehicleModel: lead.vehicleModel ?? "",
    vehicleYear: lead.vehicleYear ?? "",
    vehicleKm: lead.vehicleKm?.toString() ?? "",
    askingPrice: lead.askingPrice ?? "",
    urgency: lead.urgency ?? "",
    notes: lead.notes ?? "",
    purchasePrice: lead.purchasePrice?.toString() ?? "",
    salePrice: lead.salePrice?.toString() ?? "",
    fineDebts: lead.fineDebts?.toString() ?? "",
    ipvaDebt: lead.ipvaDebt?.toString() ?? "",
    otherExpenses: lead.otherExpenses?.toString() ?? "",
    prepCost: lead.prepCost?.toString() ?? "",
    channel: lead.channel ?? "",
  });
  const [targetMargin, setTargetMargin] = useState("");
  const [fipeValue, setFipeValue] = useState(lead.fipeValue ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get("/auth/team").then((res) => setTeam(res.data));
  }, []);

  useEffect(() => {
    setForm({
      name: lead.name ?? "",
      phone: lead.phone ?? "",
      assignedToId: lead.assignedToId ?? "",
      email: lead.email ?? "",
      address: lead.address ?? "",
      city: lead.city ?? "",
      state: lead.state ?? "",
      vehicleBrand: lead.vehicleBrand ?? "",
      vehicleModel: lead.vehicleModel ?? "",
      vehicleYear: lead.vehicleYear ?? "",
      vehicleKm: lead.vehicleKm?.toString() ?? "",
      askingPrice: lead.askingPrice ?? "",
      urgency: lead.urgency ?? "",
      notes: lead.notes ?? "",
      purchasePrice: lead.purchasePrice?.toString() ?? "",
      salePrice: lead.salePrice?.toString() ?? "",
      fineDebts: lead.fineDebts?.toString() ?? "",
      ipvaDebt: lead.ipvaDebt?.toString() ?? "",
      otherExpenses: lead.otherExpenses?.toString() ?? "",
      prepCost: lead.prepCost?.toString() ?? "",
      channel: lead.channel ?? "",
    });
    setFipeValue(lead.fipeValue ?? "");
  }, [lead.id]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleFipeFound(result: { Valor: string; Marca: string; Modelo: string; AnoModelo: number; CodigoFipe: string }) {
    setFipeValue(result.Valor);
    setForm((f) => ({
      ...f,
      vehicleBrand: result.Marca,
      vehicleModel: result.Modelo,
      vehicleYear: String(result.AnoModelo),
    }));
    const res = await api.patch(`/leads/${lead.id}`, {
      vehicleBrand: result.Marca,
      vehicleModel: result.Modelo,
      vehicleYear: String(result.AnoModelo),
      fipeValue: result.Valor,
      fipeCode: result.CodigoFipe,
    });
    onUpdated(res.data);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const res = await api.patch(`/leads/${lead.id}`, {
        name: form.name || undefined,
        phone: form.phone.replace(/\D/g, "") || undefined,
        assignedToId: form.assignedToId || null,
        email: form.email || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state || null,
        vehicleBrand: form.vehicleBrand || null,
        vehicleModel: form.vehicleModel || null,
        vehicleYear: form.vehicleYear || null,
        vehicleKm: form.vehicleKm ? parseInt(form.vehicleKm, 10) : null,
        askingPrice: form.askingPrice || undefined,
        urgency: form.urgency || undefined,
        notes: form.notes || undefined,
        purchasePrice: numOrNull(form.purchasePrice),
        salePrice: numOrNull(form.salePrice),
        fineDebts: numOrNull(form.fineDebts),
        ipvaDebt: numOrNull(form.ipvaDebt),
        otherExpenses: numOrNull(form.otherExpenses),
        prepCost: numOrNull(form.prepCost),
        channel: form.channel || null,
      });
      onUpdated(res.data);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const purchasePrice = numOrNull(form.purchasePrice) ?? 0;
  const salePrice = numOrNull(form.salePrice) ?? 0;
  const fineDebts = numOrNull(form.fineDebts) ?? 0;
  const ipvaDebt = numOrNull(form.ipvaDebt) ?? 0;
  const otherExpenses = numOrNull(form.otherExpenses) ?? 0;
  const prepCost = numOrNull(form.prepCost) ?? 0;
  const profit = salePrice - purchasePrice - fineDebts - ipvaDebt - otherExpenses - prepCost;
  const hasFinancials = form.purchasePrice || form.salePrice;

  const marginPct = numOrNull(targetMargin);
  const fixedCosts = fineDebts + ipvaDebt + otherExpenses + prepCost;
  const suggestedPurchasePrice =
    marginPct !== null && salePrice > 0 ? salePrice - fixedCosts - salePrice * (marginPct / 100) : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-600">Lead</div>
        <input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Nome do lead"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          placeholder="Telefone (com DDD)"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          type="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          placeholder="E-mail"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <CepLookup
          onFound={(result) => {
            setForm((f) => ({
              ...f,
              address: result.address ?? f.address,
              city: result.city ?? f.city,
              state: result.state ?? f.state,
            }));
          }}
        />
        <input
          value={form.address}
          onChange={(e) => set("address", e.target.value)}
          placeholder="Endereço"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <div className="flex gap-2">
          <input
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            placeholder="Cidade"
            className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            value={form.state}
            onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))}
            placeholder="UF"
            maxLength={2}
            className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500">Responsável</label>
          <select
            value={form.assignedToId}
            onChange={(e) => set("assignedToId", e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Sem responsável</option>
            {team.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-slate-500">Canal de origem</label>
          <select
            value={form.channel}
            onChange={(e) => set("channel", e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Não informado</option>
            {LEAD_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-600">Veículo</div>
        <FipeLookup onFound={handleFipeFound} />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={form.vehicleBrand}
            onChange={(e) => set("vehicleBrand", e.target.value)}
            placeholder="Marca"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            value={form.vehicleModel}
            onChange={(e) => set("vehicleModel", e.target.value)}
            placeholder="Modelo"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            value={form.vehicleYear}
            onChange={(e) => set("vehicleYear", e.target.value)}
            placeholder="Ano"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <input
            value={form.vehicleKm}
            onChange={(e) => set("vehicleKm", e.target.value.replace(/\D/g, ""))}
            placeholder="KM"
            inputMode="numeric"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        {fipeValue && (
          <div className="text-xs text-slate-500">
            Valor FIPE salvo: <strong>{fipeValue}</strong>
          </div>
        )}
        <input
          value={form.askingPrice}
          onChange={(e) => set("askingPrice", e.target.value)}
          placeholder="Valor pretendido pelo lead (ex: R$ 45.000)"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          value={form.urgency}
          onChange={(e) => set("urgency", e.target.value)}
          placeholder="Urgência (ex: precisa vender essa semana)"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Notas"
          rows={2}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-600">Financeiro da negociação</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-slate-500">Valor de compra</label>
            <input
              value={form.purchasePrice}
              onChange={(e) => set("purchasePrice", e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500">Valor de venda</label>
            <input
              value={form.salePrice}
              onChange={(e) => set("salePrice", e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500">Débitos de multa</label>
            <input
              value={form.fineDebts}
              onChange={(e) => set("fineDebts", e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500">IPVA</label>
            <input
              value={form.ipvaDebt}
              onChange={(e) => set("ipvaDebt", e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500">Outras despesas</label>
            <input
              value={form.otherExpenses}
              onChange={(e) => set("otherExpenses", e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500">Custo de preparo</label>
            <input
              value={form.prepCost}
              onChange={(e) => set("prepCost", e.target.value)}
              placeholder="0"
              inputMode="decimal"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>
        {!!hasFinancials && (
          <div
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              profit >= 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"
            }`}
          >
            Rentabilidade estimada: {maskCurrency(hidden, fmtCurrency(profit))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-600">Calculadora de oferta</div>
        <p className="text-[11px] text-slate-500">
          A partir do valor de venda e dos custos acima, calcula o valor máximo de compra para
          atingir a margem desejada.
        </p>
        <div>
          <label className="block text-[11px] text-slate-500">Margem desejada (%)</label>
          <input
            value={targetMargin}
            onChange={(e) => setTargetMargin(e.target.value)}
            placeholder="ex: 15"
            inputMode="decimal"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        {suggestedPurchasePrice !== null && (
          <div className="flex items-center justify-between gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-600">
            <span>Oferta máxima sugerida: {fmtCurrency(suggestedPurchasePrice)}</span>
            <button
              type="button"
              onClick={() => set("purchasePrice", suggestedPurchasePrice.toFixed(2))}
              className="shrink-0 rounded-md border border-emerald-500/40 px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10"
            >
              Usar
            </button>
          </div>
        )}
        {marginPct !== null && salePrice <= 0 && (
          <div className="text-xs text-slate-500">Preencha o valor de venda para calcular a oferta.</div>
        )}
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-md bg-[#0b2545] px-3 py-2 text-sm font-medium text-white hover:bg-[#122f5c] disabled:opacity-50"
      >
        {saving ? "Salvando..." : "Salvar"}
      </button>
      {saved && <div className="text-center text-xs text-emerald-600">Salvo!</div>}
    </form>
  );
}
