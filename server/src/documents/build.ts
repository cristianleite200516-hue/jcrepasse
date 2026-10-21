import type { Lead } from "@prisma/client";
import { generateDocx, dataExtenso } from "./generate";

export type DocType = "PROCURACAO" | "CONTRATO_REPASSE";

export function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const filled = (v: string | null | undefined) => !!v && v.trim() !== "";

function veicMarcaMod(lead: Lead) {
  return [lead.vehicleBrand, lead.vehicleModel].filter(Boolean).join(" / ");
}

function veicAnoMod(lead: Lead) {
  return lead.vehicleYear ? `${lead.vehicleYear}/${lead.vehicleYear}` : "";
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: Date | null | undefined) {
  if (!d) return "";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

// Confere se os campos essenciais (sem valor padrão razoável) estão preenchidos antes de
// gerar o documento, em vez de deixar buracos silenciosos num documento que vai ser assinado.
export function checkMissingFields(docType: DocType, lead: Lead): string[] {
  const checks =
    docType === "PROCURACAO"
      ? [
          { label: "Nome do lead", ok: filled(lead.name) },
          { label: "CPF/CNPJ do lead", ok: filled(lead.cpf) },
          { label: "Endereço do lead", ok: filled(lead.address) },
          { label: "Cidade e UF do lead", ok: filled(lead.city) && filled(lead.state) },
          { label: "Marca e modelo do veículo", ok: filled(lead.vehicleBrand) && filled(lead.vehicleModel) },
          { label: "Placa do veículo", ok: filled(lead.vehiclePlate) },
          { label: "Renavam do veículo", ok: filled(lead.vehicleRenavam) },
          { label: "Chassi do veículo", ok: filled(lead.vehicleChassi) },
        ]
      : [
          { label: "Nome do comprador", ok: filled(lead.buyerName) },
          { label: "CPF/CNPJ do comprador", ok: filled(lead.buyerCpf) },
          { label: "Endereço do comprador", ok: filled(lead.buyerAddress) },
          { label: "Cidade e UF do comprador", ok: filled(lead.buyerCity) && filled(lead.buyerState) },
          { label: "Nome do vendedor original (lead)", ok: filled(lead.name) },
          { label: "CPF/CNPJ do vendedor original (lead)", ok: filled(lead.cpf) },
          { label: "Marca e modelo do veículo", ok: filled(lead.vehicleBrand) && filled(lead.vehicleModel) },
          { label: "Placa do veículo", ok: filled(lead.vehiclePlate) },
          { label: "Renavam do veículo", ok: filled(lead.vehicleRenavam) },
          { label: "Chassi do veículo", ok: filled(lead.vehicleChassi) },
          { label: "Valor total recebido (valor de venda)", ok: lead.salePrice != null },
        ];
  return checks.filter((c) => !c.ok).map((c) => c.label);
}

export function buildDocxBuffer(docType: DocType, lead: Lead): Buffer {
  if (docType === "PROCURACAO") {
    return generateDocx("procuracao.docx", {
      outorgante_nome: lead.name ?? "",
      outorgante_cpf: lead.cpf ?? "",
      outorgante_nacionalidade: lead.nationality ?? "BRASILEIRO",
      outorgante_profissao: lead.profession ?? "",
      outorgante_endereco: lead.address ?? "",
      outorgante_compl: lead.addressComplement ?? "",
      outorgante_cep: lead.cep ?? "",
      outorgante_cidade_uf: [lead.city, lead.state].filter(Boolean).join(" / "),
      veic_renavam: lead.vehicleRenavam ?? "",
      veic_marca_mod: veicMarcaMod(lead),
      veic_ano_mod: veicAnoMod(lead),
      veic_categoria: lead.vehicleCategory ?? "PARTICULAR",
      veic_placa: lead.vehiclePlate ?? "",
      veic_cor: lead.vehicleColor ?? "",
      veic_chassi: lead.vehicleChassi ?? "",
      veic_alien: lead.vehicleLienBank ?? "NÃO HÁ",
      veic_especie: "PASSAGEIRO/AUTOMOVEL",
      veic_situacao: lead.vehicleSituation ?? "VIGENTE (EM CIRCULAÇÃO)",
      veic_combustivel: lead.vehicleFuel ?? "",
      veic_cidade_uf: [lead.vehicleCity ?? lead.city, lead.vehicleState ?? lead.state].filter(Boolean).join(" - "),
      assinatura_local_data: `CURITIBA – PR ${dataExtenso()}`,
    });
  }

  return generateDocx("contrato_repasse.docx", {
    comprador_nome: lead.buyerName ?? "",
    comprador_cpf: lead.buyerCpf ?? "",
    comprador_endereco: lead.buyerAddress ?? "",
    comprador_bairro: lead.buyerNeighborhood ?? "",
    comprador_cep: lead.buyerCep ?? "",
    comprador_cidade_uf: [lead.buyerCity, lead.buyerState].filter(Boolean).join("/"),
    vendedor_nome: lead.name ?? "",
    vendedor_cpf: lead.cpf ?? "",
    veic_renavam: lead.vehicleRenavam ?? "",
    veic_marca_mod: veicMarcaMod(lead),
    veic_ano_mod: veicAnoMod(lead),
    veic_categoria: lead.vehicleCategory ?? "PARTICULAR",
    veic_placa: lead.vehiclePlate ?? "",
    veic_cor: lead.vehicleColor ?? "",
    veic_chassi: lead.vehicleChassi ?? "",
    veic_alien: lead.vehicleLienBank ?? "NÃO HÁ",
    veic_especie: "PASSAGEIRO / AUTOMOVEL",
    veic_situacao: lead.vehicleSituation ?? "VIGENTE (EM CIRCULACAO)",
    veic_combustivel: lead.vehicleFuel ?? "",
    veic_cidade_uf: [lead.vehicleCity ?? lead.city, lead.vehicleState ?? lead.state].filter(Boolean).join("/"),
    taxa_operacional: fmtMoney(lead.saleOperationalFee),
    debitos_assumidos: fmtMoney(lead.saleAssumedDebts),
    total_recebido: fmtMoney(lead.salePrice),
    entrega_data: fmtDate(lead.deliveryDate),
    entrega_hora: lead.deliveryTime ?? "",
    entrega_manual: lead.deliveryManual ? "SIM" : "",
    entrega_chave: lead.deliveryKey ? "SIM" : "",
    entrega_procuracao: lead.deliveryProcuracao ? "SIM" : "",
    entrega_dut: lead.deliveryDut ? "SIM" : "",
    assinatura_local_data: `CURITIBA, ${dataExtenso()}`,
  });
}

export function buildFilename(docType: DocType, lead: Lead, ext: "docx" | "pdf" = "docx") {
  const base =
    docType === "PROCURACAO"
      ? `procuracao-${slugify(lead.name || lead.phone)}`
      : `contrato-repasse-${slugify(lead.buyerName || lead.name || lead.phone)}`;
  return `${base}.${ext}`;
}
