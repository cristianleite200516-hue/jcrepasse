import { BRAND } from "./brand";

// Título do lead em listas e cards: "Nome · Carro", pra dar pra reconhecer o lead de relance em vez
// de um "Sem nome" + número @lid que não diz nada.
interface LeadLike {
  name: string | null;
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: string | null;
  vehicleInfo?: string | null;
}

export function leadVehicleLabel(lead: LeadLike): string | null {
  const structured = [lead.vehicleBrand, lead.vehicleModel, lead.vehicleYear].filter(Boolean).join(" ").trim();
  if (structured) return structured;
  // vehicleInfo vem da IA começando por marca/modelo/ano ("Fiat Uno 2001, 150.000 km, ...")
  const summary = lead.vehicleInfo?.split(",")[0]?.trim();
  return summary ? summary.slice(0, 40) : null;
}

export function leadTitle(lead: LeadLike): string {
  const name = lead.name?.trim();
  const vehicle = leadVehicleLabel(lead);
  if (name && vehicle) return `${name} · ${vehicle}`;
  return name || vehicle || "Sem nome";
}

// Contatos no sistema LID do WhatsApp não têm número real visível — o ID interno inteiro só confunde,
// mas o final dele ainda ajuda a diferenciar dois leads sem nome.
export function leadPhoneLabel(phone: string): string {
  return phone.endsWith("@lid") ? `WhatsApp privado ···${phone.slice(-8, -4)}` : phone;
}

// DDD da região onde a loja atua (VITE_HOME_DDD, padrão 41) — esses leads aparecem primeiro no funil.
export const HOME_DDD = BRAND.homeDdd;

// DDD do lead a partir do telefone principal ou, nos contatos @lid, do número real que o
// servidor descobre pelo WhatsApp e guarda em phone2. Aceita "5541999998888", "(41) 99999-8888" etc.
// Sem número nenhum, usa o DDD da cidade que o lead citou na conversa (areaCode, preenchido pela IA).
export function leadDdd(lead: { phone: string; phone2?: string | null; areaCode?: string | null }): string | null {
  for (const raw of [lead.phone, lead.phone2]) {
    if (!raw || raw.endsWith("@lid")) continue;
    const digits = raw.replace(/@.*$/, "").replace(/\D/g, "");
    if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits.slice(2, 4);
    if (digits.length === 10 || digits.length === 11) return digits.slice(0, 2);
  }
  return lead.areaCode || null;
}

// Mostra o número real quando o servidor já descobriu (phone2), em vez do "WhatsApp privado".
export function leadDisplayPhone(lead: { phone: string; phone2?: string | null }): string {
  if (lead.phone.endsWith("@lid") && lead.phone2) return formatBrPhone(lead.phone2);
  return leadPhoneLabel(lead.phone);
}

function formatBrPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
}

// Converte texto livre de valor ("R$ 45.000", "45 mil", "45000,00") em número; null se não der pra entender.
export function parseMoney(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.toLowerCase();
  const mil = /\bmil\b|\bk\b/.test(text);
  const digits = text.replace(/[^\d.,]/g, "");
  if (!digits) return null;
  // "45.000,50" -> 45000.50 ; "45.000" -> 45000 ; "45,5" (com "mil") -> 45.5
  const normalized = digits.includes(",") ? digits.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(digits) ? digits.replace(/\./g, "") : digits;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return mil && n < 1000 ? n * 1000 : n;
}

// Pedido do lead comparado à FIPE: percentual (+ acima, − abaixo). null se faltar algum dos dois valores.
export function askingVsFipe(lead: { askingPrice?: string | null; fipeValue?: string | null }): number | null {
  const asking = parseMoney(lead.askingPrice);
  const fipe = parseMoney(lead.fipeValue);
  if (!asking || !fipe) return null;
  return Math.round(((asking - fipe) / fipe) * 100);
}

// Preenche {nome}, {veiculo} e {valor} de uma resposta rápida com os dados do lead. Variável sem
// dado fica como está, pra aparecer na caixa de texto e a pessoa completar antes de enviar.
export function fillQuickReply(
  text: string,
  lead: LeadLike & { askingPrice?: string | null }
): string {
  const firstName = lead.name?.trim().split(/\s+/)[0];
  const vars: Record<string, string | null | undefined> = {
    nome: firstName,
    veiculo: leadVehicleLabel(lead),
    valor: lead.askingPrice,
  };
  return text.replace(/\{(nome|veiculo|veículo|valor)\}/gi, (match, key: string) => {
    const k = key.toLowerCase().replace("í", "i");
    return vars[k] || match;
  });
}
