import { FormEvent, useState } from "react";
import { api, API_HOST } from "../lib/api";
import { Lead } from "../lib/types";
import { SignatureStatus } from "./SignatureStatus";

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

async function downloadDoc(
  url: string,
  filename: string,
  setError: (e: string | null) => void,
  onMissing: () => void
) {
  setError(null);
  try {
    const res = await api.get(url, { responseType: "blob" });
    const blobUrl = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (err: any) {
    const blob: Blob | undefined = err?.response?.data;
    if (blob instanceof Blob) {
      try {
        const parsed = JSON.parse(await blob.text());
        if (Array.isArray(parsed?.missing) && parsed.missing.length > 0) {
          setError(`Falta preencher: ${parsed.missing.join(", ")}.`);
          onMissing();
          return;
        }
      } catch {
        // não era JSON, cai no erro genérico abaixo
      }
    }
    setError("Não foi possível gerar o documento.");
  }
}

export function LeadDocuments({ lead, onUpdated }: { lead: Lead; onUpdated: (lead: Lead) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  const [form, setForm] = useState({
    cpf: lead.cpf ?? "",
    rg: lead.rg ?? "",
    nationality: lead.nationality ?? "BRASILEIRO",
    profession: lead.profession ?? "",
    addressComplement: lead.addressComplement ?? "",
    cep: lead.cep ?? "",

    vehiclePlate: lead.vehiclePlate ?? "",
    vehicleChassi: lead.vehicleChassi ?? "",
    vehicleRenavam: lead.vehicleRenavam ?? "",
    vehicleColor: lead.vehicleColor ?? "",
    vehicleFuel: lead.vehicleFuel ?? "",
    vehicleCategory: lead.vehicleCategory ?? "PARTICULAR",
    vehicleSituation: lead.vehicleSituation ?? "VIGENTE (EM CIRCULAÇÃO)",
    vehicleCity: lead.vehicleCity ?? "",
    vehicleState: lead.vehicleState ?? "",
    vehicleLienBank: lead.vehicleLienBank ?? "",

    buyerName: lead.buyerName ?? "",
    buyerCpf: lead.buyerCpf ?? "",
    buyerRg: lead.buyerRg ?? "",
    buyerNationality: lead.buyerNationality ?? "BRASILEIRO",
    buyerProfession: lead.buyerProfession ?? "",
    buyerPhone: lead.buyerPhone ?? "",
    buyerEmail: lead.buyerEmail ?? "",
    buyerAddress: lead.buyerAddress ?? "",
    buyerNeighborhood: lead.buyerNeighborhood ?? "",
    buyerCep: lead.buyerCep ?? "",
    buyerCity: lead.buyerCity ?? "",
    buyerState: lead.buyerState ?? "",

    saleOperationalFee: lead.saleOperationalFee?.toString() ?? "",
    saleAssumedDebts: lead.saleAssumedDebts?.toString() ?? "",
    deliveryDate: lead.deliveryDate?.slice(0, 10) ?? "",
    deliveryTime: lead.deliveryTime ?? "",
  });
  const [deliveryManual, setDeliveryManual] = useState(lead.deliveryManual);
  const [deliveryKey, setDeliveryKey] = useState(lead.deliveryKey);
  const [deliveryProcuracao, setDeliveryProcuracao] = useState(lead.deliveryProcuracao);
  const [deliveryDut, setDeliveryDut] = useState(lead.deliveryDut);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const res = await api.patch(`/leads/${lead.id}`, {
        ...form,
        saleOperationalFee: numOrNull(form.saleOperationalFee),
        saleAssumedDebts: numOrNull(form.saleAssumedDebts),
        deliveryDate: form.deliveryDate || null,
        deliveryManual,
        deliveryKey,
        deliveryProcuracao,
        deliveryDut,
      });
      onUpdated(res.data);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const input = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";
  const label = "block text-[11px] text-slate-500";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-semibold text-slate-600"
      >
        <span>Documentos (procuração / contrato de repasse)</span>
        <span className="text-xs text-slate-500">{open ? "ocultar ▲" : "mostrar ▼"}</span>
      </button>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() =>
            downloadDoc(
              `${API_HOST}/api/documents/leads/${lead.id}/procuracao`,
              `procuracao-${lead.name || lead.phone}.docx`,
              setDocError,
              () => setOpen(true)
            )
          }
          className="rounded-md bg-[#0b2545] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#122f5c]"
        >
          Gerar Procuração
        </button>
        <button
          type="button"
          onClick={() =>
            downloadDoc(
              `${API_HOST}/api/documents/leads/${lead.id}/contrato-repasse`,
              `contrato-repasse-${lead.buyerName || lead.name || lead.phone}.docx`,
              setDocError,
              () => setOpen(true)
            )
          }
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
        >
          Gerar Contrato de Repasse
        </button>
      </div>
      {docError && <div className="text-xs text-red-600">{docError}</div>}

      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:gap-6">
        <SignatureStatus leadId={lead.id} docType="PROCURACAO" />
        <SignatureStatus leadId={lead.id} docType="CONTRATO_REPASSE" />
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-500">Dados pessoais do lead (outorgante)</div>
            <div className="grid grid-cols-2 gap-2">
              <input value={form.cpf} onChange={(e) => set("cpf", e.target.value)} placeholder="CPF" className={input} />
              <input value={form.rg} onChange={(e) => set("rg", e.target.value)} placeholder="RG" className={input} />
              <input
                value={form.nationality}
                onChange={(e) => set("nationality", e.target.value)}
                placeholder="Nacionalidade"
                className={input}
              />
              <input
                value={form.profession}
                onChange={(e) => set("profession", e.target.value)}
                placeholder="Profissão"
                className={input}
              />
              <input
                value={form.addressComplement}
                onChange={(e) => set("addressComplement", e.target.value)}
                placeholder="Complemento (ex: Casa 11)"
                className={input}
              />
              <input value={form.cep} onChange={(e) => set("cep", e.target.value)} placeholder="CEP" className={input} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-500">Dados do veículo (documento)</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.vehiclePlate}
                onChange={(e) => set("vehiclePlate", e.target.value.toUpperCase())}
                placeholder="Placa"
                className={input}
              />
              <input
                value={form.vehicleChassi}
                onChange={(e) => set("vehicleChassi", e.target.value.toUpperCase())}
                placeholder="Chassi"
                className={input}
              />
              <input
                value={form.vehicleRenavam}
                onChange={(e) => set("vehicleRenavam", e.target.value)}
                placeholder="Renavam"
                className={input}
              />
              <input
                value={form.vehicleColor}
                onChange={(e) => set("vehicleColor", e.target.value)}
                placeholder="Cor predominante"
                className={input}
              />
              <input
                value={form.vehicleFuel}
                onChange={(e) => set("vehicleFuel", e.target.value)}
                placeholder="Combustível"
                className={input}
              />
              <input
                value={form.vehicleCategory}
                onChange={(e) => set("vehicleCategory", e.target.value)}
                placeholder="Categoria"
                className={input}
              />
              <input
                value={form.vehicleSituation}
                onChange={(e) => set("vehicleSituation", e.target.value)}
                placeholder="Situação"
                className={input}
              />
              <input
                value={form.vehicleLienBank}
                onChange={(e) => set("vehicleLienBank", e.target.value)}
                placeholder="Alienação fiduciária (ou 'NÃO HÁ')"
                className={input}
              />
              <input
                value={form.vehicleCity}
                onChange={(e) => set("vehicleCity", e.target.value)}
                placeholder="Cidade de registro do veículo"
                className={input}
              />
              <input
                value={form.vehicleState}
                onChange={(e) => set("vehicleState", e.target.value.toUpperCase().slice(0, 2))}
                placeholder="UF de registro"
                className={input}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-500">
              Comprador (para o Contrato de Repasse, quando o veículo é revendido)
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.buyerName}
                onChange={(e) => set("buyerName", e.target.value)}
                placeholder="Nome do comprador"
                className={input}
              />
              <input
                value={form.buyerCpf}
                onChange={(e) => set("buyerCpf", e.target.value)}
                placeholder="CPF do comprador"
                className={input}
              />
              <input
                value={form.buyerRg}
                onChange={(e) => set("buyerRg", e.target.value)}
                placeholder="RG do comprador"
                className={input}
              />
              <input
                value={form.buyerNationality}
                onChange={(e) => set("buyerNationality", e.target.value)}
                placeholder="Nacionalidade"
                className={input}
              />
              <input
                value={form.buyerProfession}
                onChange={(e) => set("buyerProfession", e.target.value)}
                placeholder="Profissão"
                className={input}
              />
              <input
                value={form.buyerPhone}
                onChange={(e) => set("buyerPhone", e.target.value)}
                placeholder="Telefone"
                className={input}
              />
              <input
                value={form.buyerEmail}
                onChange={(e) => set("buyerEmail", e.target.value)}
                placeholder="E-mail"
                className={input}
              />
              <input
                value={form.buyerAddress}
                onChange={(e) => set("buyerAddress", e.target.value)}
                placeholder="Endereço (Rua/Av, nº)"
                className={input}
              />
              <input
                value={form.buyerNeighborhood}
                onChange={(e) => set("buyerNeighborhood", e.target.value)}
                placeholder="Bairro"
                className={input}
              />
              <input
                value={form.buyerCep}
                onChange={(e) => set("buyerCep", e.target.value)}
                placeholder="CEP"
                className={input}
              />
              <input
                value={form.buyerCity}
                onChange={(e) => set("buyerCity", e.target.value)}
                placeholder="Cidade"
                className={input}
              />
              <input
                value={form.buyerState}
                onChange={(e) => set("buyerState", e.target.value.toUpperCase().slice(0, 2))}
                placeholder="UF"
                className={input}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-500">Revenda e entrega</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>Taxa operacional (R$)</label>
                <input
                  value={form.saleOperationalFee}
                  onChange={(e) => set("saleOperationalFee", e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                  className={`${input} w-full`}
                />
              </div>
              <div>
                <label className={label}>Débitos assumidos (R$)</label>
                <input
                  value={form.saleAssumedDebts}
                  onChange={(e) => set("saleAssumedDebts", e.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                  className={`${input} w-full`}
                />
              </div>
              <div>
                <label className={label}>Data de entrega</label>
                <input
                  type="date"
                  value={form.deliveryDate}
                  onChange={(e) => set("deliveryDate", e.target.value)}
                  className={`${input} w-full`}
                />
              </div>
              <div>
                <label className={label}>Hora de entrega</label>
                <input
                  type="time"
                  value={form.deliveryTime}
                  onChange={(e) => set("deliveryTime", e.target.value)}
                  className={`${input} w-full`}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-4 pt-1 text-xs text-slate-600">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={deliveryManual} onChange={(e) => setDeliveryManual(e.target.checked)} />
                Manual entregue
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={deliveryKey} onChange={(e) => setDeliveryKey(e.target.checked)} />
                Chave entregue
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={deliveryProcuracao}
                  onChange={(e) => setDeliveryProcuracao(e.target.checked)}
                />
                Procuração entregue
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={deliveryDut} onChange={(e) => setDeliveryDut(e.target.checked)} />
                DUT entregue
              </label>
            </div>
            <p className="text-[11px] text-slate-500">
              Total recebido usa o valor de venda já preenchido no bloco Financeiro acima.
            </p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-md bg-[#0b2545] px-3 py-2 text-sm font-medium text-white hover:bg-[#122f5c] disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar dados dos documentos"}
          </button>
          {saved && <div className="text-center text-xs text-emerald-600">Salvo!</div>}
        </form>
      )}
    </div>
  );
}
