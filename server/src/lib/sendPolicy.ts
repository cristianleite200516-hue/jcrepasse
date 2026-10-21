import { prisma } from "./prisma";

// Regras pra disparos em lote (campanhas, envio em massa, reengajamento) não parecerem robô pro
// WhatsApp: intervalo aleatório e longo entre mensagens, limite de envios por dia e respeito a quem
// pediu pra sair. Não elimina o risco de banimento (a conexão é não oficial), só reduz.

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const SEND_POLICY = {
  minDelayS: num(process.env.BROADCAST_MIN_DELAY_S, 25),
  maxDelayS: num(process.env.BROADCAST_MAX_DELAY_S, 75),
  dailyLimit: Math.floor(num(process.env.BROADCAST_DAILY_LIMIT, 150)),
};

// Intervalo aleatório entre os envios (padrão 25 a 75 s), pra não ter ritmo fixo.
export function randomDelayMs(): number {
  const min = Math.min(SEND_POLICY.minDelayS, SEND_POLICY.maxDelayS);
  const max = Math.max(SEND_POLICY.minDelayS, SEND_POLICY.maxDelayS);
  return Math.round((min + Math.random() * (max - min)) * 1000);
}

function todayKey(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

// Quantos envios em lote ainda cabem hoje.
export async function remainingToday(): Promise<number> {
  const s = await prisma.settings.findUnique({
    where: { id: "singleton" },
    select: { broadcastSentDay: true, broadcastSentCount: true },
  });
  const used = s?.broadcastSentDay === todayKey() ? s.broadcastSentCount : 0;
  return Math.max(0, SEND_POLICY.dailyLimit - used);
}

export async function recordBroadcastSent(count = 1): Promise<void> {
  const today = todayKey();
  const s = await prisma.settings.findUnique({
    where: { id: "singleton" },
    select: { broadcastSentDay: true, broadcastSentCount: true },
  });
  if (!s) return;
  const base = s.broadcastSentDay === today ? s.broadcastSentCount : 0;
  await prisma.settings.update({
    where: { id: "singleton" },
    data: { broadcastSentDay: today, broadcastSentCount: base + count },
  });
}

// Preenche {nome}, {veiculo} e {valor} com os dados do lead; quem não tem o dado fica sem a palavra
// solta (evita mandar "Oi {nome}" literal).
export function fillTemplate(
  text: string,
  lead: {
    name: string | null;
    vehicleBrand?: string | null;
    vehicleModel?: string | null;
    vehicleYear?: string | null;
    vehicleInfo?: string | null;
    askingPrice?: string | null;
  }
): string {
  const firstName = lead.name?.trim().split(/\s+/)[0] ?? "";
  const structured = [lead.vehicleBrand, lead.vehicleModel, lead.vehicleYear].filter(Boolean).join(" ").trim();
  const vehicle = structured || lead.vehicleInfo?.split(",")[0]?.trim() || "";
  const vars: Record<string, string> = { nome: firstName, veiculo: vehicle || "veículo", valor: lead.askingPrice ?? "" };
  return text
    .replace(/\{(nome|veiculo|veículo|valor)\}/gi, (_m, key: string) => vars[key.toLowerCase().replace("í", "i")] ?? "")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Mensagem do lead pedindo pra parar de receber: só a palavra (ou frase curta), pra não confundir
// com uma conversa normal que cite "sair".
export function isOptOutMessage(body: string): boolean {
  const t = body
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 40) return false;
  return /^(sair|parar|pare|stop|cancelar|descadastrar|remover|nao quero (mais )?receber( mensagens?)?|nao me (envie|mande) mais( mensagens?)?|me tire da lista|sair da lista)$/.test(t);
}
