import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import qrcode from "qrcode";
import { Client, LocalAuth, Location, Message, MessageMedia } from "whatsapp-web.js";
import { Prisma } from "@prisma/client";
import { fillTemplate, isOptOutMessage, randomDelayMs, recordBroadcastSent, remainingToday } from "../lib/sendPolicy";
import { prisma } from "../lib/prisma";
import { getIO } from "../lib/events";
import { generateAiReply, isAiPaused } from "../ai/attendant";

// Fica dentro de .wwebjs_auth (montado no volume persistente do Railway) de propósito: uma
// pasta "uploads" separada, fora do volume, é recriada vazia a cada deploy — as fotos e
// documentos que os leads mandam somem sozinhos sem nenhum aviso.
//
// ATENÇÃO — NUNCA rode "rm -rf .wwebjs_auth" inteiro pra forçar um logout/reset do WhatsApp:
// isso apaga os uploads de negócio junto (aconteceu de verdade em 23/09/2026, 778 anexos
// perdidos sem backup, sem Time Machine nem Dropbox cobrindo essa pasta). Pra resetar só a
// sessão do WhatsApp, apague APENAS ".wwebjs_auth/session" (e ".wwebjs_cache" na raiz do
// projeto, se precisar) — nunca ".wwebjs_auth" inteira.
const UPLOADS_DIR = path.join(__dirname, "..", "..", ".wwebjs_auth", "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "application/pdf": ".pdf",
};

// Salva fotos/documentos que o lead manda pelo WhatsApp direto na aba de anexos do lead,
// sem precisar de upload manual. Ignora figurinhas, áudios e vídeos — só o que interessa
// pra avaliar o veículo (fotos) ou documentação.
async function saveIncomingMedia(msg: Message, leadId: string) {
  if (msg.type !== "image" && msg.type !== "document") return;

  const media = await msg.downloadMedia().catch((err) => {
    console.error("Falha ao baixar mídia da mensagem do WhatsApp:", err);
    return null;
  });
  if (!media) return;

  const ext = media.filename
    ? path.extname(media.filename)
    : MIME_EXTENSIONS[media.mimetype] ?? "";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const buffer = Buffer.from(media.data, "base64");
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);

  const attachment = await prisma.attachment.create({
    data: {
      leadId,
      filename,
      originalName: media.filename || filename,
      mimeType: media.mimetype,
      size: buffer.length,
      category: msg.type === "image" ? "FOTO" : "DOCUMENTO",
    },
  });

  getIO().emit("attachments:updated", { leadId });
  return attachment;
}

let client: Client | null = null;
let status: "DISCONNECTED" | "QR" | "CONNECTING" | "READY" = "DISCONNECTED";
let recoveryAttempts = 0;
const MAX_RECOVERY_ATTEMPTS = 5;

// Enquanto uma reconexão já está em andamento, ignora novos sinais de "quebrou" — sem isso, uma
// chamada atrasada de ANTES do crash (ex: várias abas abertas resolvendo número de vários leads
// ao mesmo tempo) chegava DEPOIS do Chrome novo já ter subido e derrubava essa tentativa nova de
// novo, num loop que nunca estabilizava (várias tentativas "1/5" em sequência, sem nunca emplacar).
let reconnecting = false;

// Guarda o último QR code gerado (data URL). O evento "qr" do whatsapp-web.js só dispara uma vez
// por code — quem abrir a tela de conexão DEPOIS desse momento (ex: deu refresh, ou só entrou
// mais tarde) nunca mais via o QR, mesmo com o status ainda em "QR", até o próximo reinício.
let lastQr: string | null = null;
let lastQrAt = 0;
// Marca o momento em que o "authenticated" disparou (status vira "CONNECTING"). O WhatsApp Web
// às vezes trava nessa fase — depois do login, carregando a interface principal — sem nunca
// disparar "ready" e sem lançar nenhum erro (mesma classe de trava silenciosa do QR parado, só
// que numa etapa diferente do fluxo). Sem isso, ficava mostrando "Conectando..." pra sempre.
let connectingAt = 0;

export function getWhatsAppQr() {
  return lastQr;
}

// O WhatsApp Web troca o QR sozinho a cada ~20-60s enquanto ninguém escaneia, e a etapa
// "Conectando..." (pós-login, carregando a interface) normalmente termina em poucos segundos —
// se qualquer uma das duas fica parada tempo demais é sinal de que a página do Chrome travou
// "quieta" (sem lançar nenhum erro pra recoverIfFrameDead pegar), porque não tem nenhuma operação
// em andamento pra falhar. Sem essa checagem periódica, esses travamentos ficavam invisíveis: o
// status ficava preso em "QR" (mostrando um código já expirado) ou em "CONNECTING" pra sempre, e
// só um reinício manual do servidor resolvia.
const QR_STALL_TIMEOUT_MS = 90_000;
// Depois do login o WhatsApp Web sincroniza o histórico, e numa conta grande isso passa fácil de 2
// min — com o limite antigo (120s) a recuperação matava a sincronização no meio, num loop de
// "travado em Conectando..." a cada reinício. Agora o prazo é maior e é renovado a cada sinal de
// progresso da sincronização (evento loading_screen), então só dispara se travar de verdade.
const CONNECTING_STALL_TIMEOUT_MS = 8 * 60_000;
const STALL_WATCHDOG_INTERVAL_MS = 30_000;

// "READY" também trava "quieto": a página do WhatsApp Web pode morrer por dentro (mesma classe de
// trava dos casos QR/CONNECTING acima) sem nunca lançar erro nem mudar de status — o painel segue
// mostrando "Conectado" enquanto nem mensagem entra nem sai. Como não existe nenhuma operação em
// andamento pra falhar e disparar recoverIfFrameDead nesse caso (ninguém tentou enviar nada), só um
// ping ativo periódico — perguntando pra própria página se ela ainda responde — pega isso. Foi
// exatamente esse buraco que deixou o WhatsApp "Conectado" no painel só recebendo depois pra voltar
// só com reinício manual do servidor.
const READY_PING_TIMEOUT_MS = 15_000;
// A página fica ocupada (sem responder getState a tempo) em situações normais: sincronizando o
// histórico logo depois de conectar, ou serializando todas as conversas num getChats() da
// importação, que leva minutos. Um único ping lento derrubava a conexão bem no meio disso —
// "conecta e cai" e a importação nunca terminava. Por isso: carência depois do "ready", nada de
// ping durante a importação, e só recupera depois de várias falhas seguidas.
const READY_PING_GRACE_MS = 3 * 60_000;
const READY_PING_MAX_FAILURES = 4;
let readyAt = 0;
let importInProgress = false;
let pingFailures = 0;
let pingInFlight = false;

async function pingWhatsAppConnection() {
  if (!client || status !== "READY" || importInProgress || pingInFlight) return;
  if (Date.now() - readyAt < READY_PING_GRACE_MS) return;
  pingInFlight = true;
  let failed = false;
  try {
    const timeout = new Promise<"TIMEOUT">((resolve) => setTimeout(() => resolve("TIMEOUT"), READY_PING_TIMEOUT_MS));
    const result = await Promise.race([client.getState(), timeout]);
    failed = result === "TIMEOUT";
  } catch (err) {
    console.error("WhatsApp: ping de verificação da conexão falhou:", err);
    failed = true;
  } finally {
    pingInFlight = false;
  }
  if (!failed) {
    pingFailures = 0;
    return;
  }
  // A importação pode ter começado enquanto esse ping esperava — aí a lentidão é esperada.
  if (importInProgress) return;
  pingFailures++;
  console.error(`WhatsApp: ping sem resposta (${pingFailures}/${READY_PING_MAX_FAILURES})`);
  if (pingFailures >= READY_PING_MAX_FAILURES) {
    pingFailures = 0;
    console.error("WhatsApp: conexão parou de responder, recuperando sozinho...");
    recoverWhatsAppFromCrash();
  }
}

setInterval(() => {
  if (status === "QR" && lastQrAt > 0 && Date.now() - lastQrAt > QR_STALL_TIMEOUT_MS) {
    console.error("WhatsApp: QR code parou de girar (página travada), recuperando sozinho...");
    recoverWhatsAppFromCrash();
    return;
  }
  if (status === "CONNECTING" && connectingAt > 0 && Date.now() - connectingAt > CONNECTING_STALL_TIMEOUT_MS) {
    console.error("WhatsApp: ficou travado em \"Conectando...\" depois do login, recuperando sozinho...");
    recoverWhatsAppFromCrash();
    return;
  }
  if (status === "READY") {
    pingWhatsAppConnection();
  }
}, STALL_WATCHDOG_INTERVAL_MS);

// Quando o lead manda várias mensagens seguidas rápido (ex: várias fotos de uma vez), cada uma
// chegava como um evento "message" separado e cada um disparava sua própria chamada à IA em
// paralelo — resultado: várias respostas quase idênticas mandadas em rajada, parecendo spam.
// Isso aqui espera um período de silêncio antes de responder, e cancela/reagenda a cada nova
// mensagem, então uma rajada de mensagens vira UMA resposta só, com todo o contexto já salvo.
const REPLY_DEBOUNCE_MS = 3000;
const pendingReplyTimers = new Map<string, NodeJS.Timeout>();

function scheduleAiReply(leadId: string, phone: string) {
  const existing = pendingReplyTimers.get(leadId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    pendingReplyTimers.delete(leadId);
    const reply = await generateAiReply(leadId).catch((err) => {
      console.error("Erro ao gerar resposta da IA:", err);
      return null;
    });
    if (reply) {
      await sendWhatsAppMessage(phone, reply).catch((err) =>
        console.error("Erro ao enviar mensagem via WhatsApp:", err)
      );
    }
  }, REPLY_DEBOUNCE_MS);

  pendingReplyTimers.set(leadId, timer);
}

// A IA atende essa conversa agora? Desligada de vez (aiEnabled=false) ou pausada temporariamente
// porque alguém da equipe acabou de responder (aiPausedUntil no futuro) = não.
export function isAiActiveNow(conversation: { aiEnabled: boolean; aiPausedUntil: Date | null }) {
  return conversation.aiEnabled && (!conversation.aiPausedUntil || conversation.aiPausedUntil <= new Date());
}

// Mesmo critério de isAiActiveNow, como filtro do Prisma.
function aiActiveWhere() {
  return { aiEnabled: true, OR: [{ aiPausedUntil: null }, { aiPausedUntil: { lte: new Date() } }] };
}

export function getWhatsAppStatus() {
  return status;
}

const SESSION_DIR = path.join(__dirname, "..", "..", ".wwebjs_auth", "session");

// Limpa o lock do perfil do Chrome (e mata qualquer processo órfão preso nele) antes de tentar
// abrir um Chrome novo — sem isso o Puppeteer se recusa a abrir ("Failed to launch the browser
// process!") ou, se o processo antigo ainda estiver de pé competindo pelo mesmo perfil, a nova
// tentativa fica mais lenta/instável e pode estourar o timeout de inicialização.
function cleanupOrphanChrome() {
  try {
    execFileSync("pkill", ["-9", "-f", SESSION_DIR]);
  } catch {
    // pkill sai com erro quando não acha nenhum processo — não tem órfão mesmo, segue o jogo
  }
  for (const file of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    fs.rmSync(path.join(SESSION_DIR, file), { force: true });
  }
}

// A whatsapp-web.js às vezes lança uma exceção não tratada bem no meio do login
// ("Execution context was destroyed") por causa de um bug interno dela — o processo
// Node não morre mais por causa disso (ver index.ts), mas o client fica travado num
// estado quebrado. Isso aqui derruba esse client travado e tenta reconectar sozinho.
export async function recoverWhatsAppFromCrash() {
  if (!client || reconnecting) return;
  if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
    console.error(
      `WhatsApp: ${MAX_RECOVERY_ATTEMPTS} tentativas de recuperação falharam, desistindo. Clique em "Conectar" pra tentar de novo.`
    );
    reconnecting = false;
    // Sem isso, "desistir" só saía da função sem soltar o client nem matar o Chrome travado:
    // status ficava preso em CONNECTING pra sempre (o watchdog periódico via isso e chamava essa
    // função de novo a cada 30s, reimprimindo esse mesmo aviso num loop infinito), e um clique
    // manual em "Conectar" não adiantava nada porque initWhatsApp() via o client antigo ainda
    // setado e nem tentava de novo — só um reinício MANUAL do processo inteiro resolvia, quando a
    // mensagem de erro dizia justamente isso, mas nunca precisou ser assim.
    const broken = client;
    client = null;
    status = "DISCONNECTED";
    connectingAt = 0;
    lastQrAt = 0;
    getIO().emit("whatsapp:status", { status });
    try {
      broken.pupBrowser?.process()?.kill("SIGKILL");
    } catch {
      // processo já pode ter morrido sozinho
    }
    cleanupOrphanChrome();
    scheduleRetryRoundAfterGivingUp();
    return;
  }
  reconnecting = true;
  recoveryAttempts++;
  console.error(`WhatsApp: recuperando de uma falha interna (tentativa ${recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS})...`);
  const broken = client;
  client = null;
  status = "DISCONNECTED";
  getIO().emit("whatsapp:status", { status });

  // Só chamar broken.destroy() não é suficiente: se o Chrome já estiver travado (o motivo de
  // estarmos recuperando), destroy() pode não matar o processo de verdade nem liberar o lock do
  // perfil (SingletonLock) — aí a PRÓXIMA tentativa de conectar falha com "Failed to launch the
  // browser process!". Aqui a gente mata o processo do Chrome na força bruta e limpa o lock
  // manualmente antes de tentar de novo, replicando a limpeza manual que resolvia isso até agora.
  try {
    broken.pupBrowser?.process()?.kill("SIGKILL");
  } catch {
    // processo já pode ter morrido sozinho
  }
  await broken.destroy().catch(() => {});
  cleanupOrphanChrome();

  // Libera o guard ANTES da nova tentativa, não depois de "ready": senão, se essa tentativa nova
  // travar de novo (mesma classe de trava), o watchdog periódico detecta mas recoverWhatsAppFromCrash
  // não faz nada (reconnecting ainda true) — parecia estar "tentando de novo" nos logs (a msg de
  // trava repetia a cada 30s) mas na real tinha desistido silenciosamente na 1ª tentativa, sem
  // nunca imprimir o aviso de desistência nem soltar o Chrome travado.
  setTimeout(() => {
    reconnecting = false;
    initWhatsApp();
  }, 3000);
}

// Cobre o caso em que o Chrome nem chega a abrir de verdade (ex: "Timed out ... waiting for the
// WS endpoint URL", geralmente por causa de um processo órfão travando o perfil) — client.initialize()
// rejeita ANTES de existir um client "quebrado" pra recoverWhatsAppFromCrash derrubar, então sem
// isso aqui a conexão ficava caída pra sempre até alguém notar e clicar em "Conectar" de novo.
// Depois de esgotar as tentativas seguidas, em vez de desistir de vez (aconteceu: caiu às 2h da
// madrugada e ficou 30h+ fora até alguém clicar em "Conectar"), espera um pouco e começa uma rodada
// nova do zero. Um timer só por vez; se alguém reconectar manualmente antes, não faz nada.
const RETRY_ROUND_DELAY_MS = 10 * 60 * 1000;
let retryRoundTimer: NodeJS.Timeout | null = null;

function scheduleRetryRoundAfterGivingUp() {
  if (retryRoundTimer) return;
  console.error(`WhatsApp: nova rodada de tentativas em ${RETRY_ROUND_DELAY_MS / 60000} min.`);
  retryRoundTimer = setTimeout(() => {
    retryRoundTimer = null;
    if (client || status === "READY") return;
    recoveryAttempts = 0;
    console.log("WhatsApp: começando nova rodada de tentativas de reconexão...");
    initWhatsApp();
  }, RETRY_ROUND_DELAY_MS);
}

function scheduleInitRetry() {
  if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
    console.error(`WhatsApp: ${MAX_RECOVERY_ATTEMPTS} tentativas de reconexão falharam.`);
    reconnecting = false;
    scheduleRetryRoundAfterGivingUp();
    return;
  }
  reconnecting = true;
  recoveryAttempts++;
  console.error(
    `WhatsApp: tentando reconectar sozinho após falha de inicialização (tentativa ${recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS})...`
  );
  cleanupOrphanChrome();
  // Mesmo motivo do reset em recoverWhatsAppFromCrash(): liberar o guard só depois de "ready"
  // deixava qualquer nova trava (init falhando de novo) presa pra sempre, sem tentar de novo nem
  // desistir de verdade.
  setTimeout(() => {
    reconnecting = false;
    initWhatsApp();
  }, 5000);
}

// A página do WhatsApp Web às vezes recarrega/navega sozinha (comportamento do próprio site,
// fora do nosso controle) e deixa a referência interna do Puppeteer "morta" — todas as chamadas
// seguintes (enviar mensagem, resolver contato, etc.) passam a falhar com um destes erros até
// alguém reiniciar a conexão. Detectando isso na hora e chamando recoverWhatsAppFromCrash() o
// sistema se recupera sozinho, sem precisar derrubar o processo inteiro manualmente.
//
// "ProtocolError" (sem espaço, "E" maiúsculo) é o NOME da classe de erro que o puppeteer-core
// lança quando uma chamada CDP (Runtime.callFunctionOn, por ex.) estoura o protocolTimeout —
// ficava de fora por engano (o marcador antigo era "Protocol error", com espaço e "e" minúsculo,
// que nunca bate com essa mensagem). Sem bater, uma página travada nunca disparava a recuperação
// automática: o client seguia reportando "READY" pro frontend enquanto, na prática, parava de
// mandar E de receber mensagem nenhuma até alguém notar e reiniciar o servidor manualmente.
const FRAME_DEATH_MARKERS = [
  "detached Frame",
  "Execution context was destroyed",
  "Target closed",
  "Protocol error",
  "ProtocolError",
  "timed out",
];
function isFrameDeathError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  return FRAME_DEATH_MARKERS.some((marker) => msg.includes(marker) || name.includes(marker));
}

function recoverIfFrameDead(err: unknown) {
  if (isFrameDeathError(err)) recoverWhatsAppFromCrash();
}

function normalizePhone(waId: string) {
  // waId chega como "5511999999999@c.us" -> guardamos só os dígitos
  return waId.replace(/@c\.us$/, "");
}

export function initWhatsApp() {
  if (client) return client;

  // Limpa qualquer lock/processo órfão de uma tentativa anterior (ex: depois de desistir após
  // MAX_RECOVERY_ATTEMPTS sem sucesso) antes de lançar um Chrome novo — sem isso, o clique manual
  // em "Conectar" esbarra num "Failed to create SingletonLock: File exists" e nem tenta de novo.
  cleanupOrphanChrome();

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
    // A instabilidade original ("Execution context was destroyed" logo após o login) era
    // causada pelo Chrome 146 (bem recente) baixado pelo Puppeteer por padrão — resolvida
    // fixando o Puppeteer numa versão mais antiga (ver overrides no package.json), que baixa
    // um Chrome mais maduro/estável. Não usamos webVersion/webVersionCache fixos aqui porque
    // uma versão "alpha" do WhatsApp Web fixada quebrava o Contact.getChat() (usado na
    // importação de conversas) mesmo com a conexão principal funcionando.
    puppeteer: {
      headless: true,
      // --disable-dev-shm-usage: dentro do container o /dev/shm é minúsculo e o Chrome usa ele
      // pra memória compartilhada — quando enche, a página do WhatsApp Web fica sem responder a
      // nenhum comando (ping, envio, importação) por minutos, ou morre com "Target closed". Os
      // outros cortam processos/recursos que não servem pra nada sem tela, economizando memória
      // num serviço que já encosta no limite do plano.
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--mute-audio",
        // Cache HTTP do Chrome fora do volume persistente: o perfil (.wwebjs_auth/session) fica no
        // volume de 500 MB junto com os anexos dos leads, e o cache crescendo lá dentro encheu o
        // disco — aí o WhatsApp Web não conseguia mais gravar no IndexedDB e todo envio falhava
        // ("QuotaExceededError ... full disk", que aparecia como "r" / "Lid is missing in chat
        // table"). Cache é descartável; o que precisa persistir (login, IndexedDB) continua no perfil.
        "--disk-cache-dir=/tmp/wwebjs-chrome-cache",
        "--disk-cache-size=104857600",
      ],
      // client.getChats()/getContacts() serializam TODAS as conversas/contatos numa única
      // chamada de página — numa conta com histórico grande, isso passa fácil do timeout padrão
      // do Puppeteer (180s) rodando no Chrome enxuto do Railway, e a importação falhava sempre
      // com "Runtime.callFunctionOn timed out" antes mesmo de terminar de listar os chats.
      protocolTimeout: 600_000,
    },
  });

  client.on("qr", async (qr) => {
    status = "QR";
    lastQrAt = Date.now();
    // width/margin maiores deixam o code mais nítido e fácil de focar pela câmera do celular —
    // no tamanho padrão da lib ele saía pequeno e a tela ampliava, ficando borrado.
    const dataUrl = await qrcode.toDataURL(qr, { width: 500, margin: 2 });
    lastQr = dataUrl;
    getIO().emit("whatsapp:qr", { qr: dataUrl });
    getIO().emit("whatsapp:status", { status });
  });

  client.on("authenticated", () => {
    console.log("WhatsApp: login feito, sincronizando...");
    status = "CONNECTING";
    connectingAt = Date.now();
    lastQr = null;
    getIO().emit("whatsapp:status", { status });
  });

  client.on("loading_screen", (percent: number) => {
    if (status === "CONNECTING") connectingAt = Date.now();
    console.log(`WhatsApp: sincronizando ${percent}%`);
  });

  client.on("ready", () => {
    console.log("WhatsApp: conectado (ready)");
    status = "READY";
    readyAt = Date.now();
    pingFailures = 0;
    recoveryAttempts = 0;
    reconnecting = false;
    lastQr = null;
    getIO().emit("whatsapp:status", { status });
    // Espera a página assentar depois do login antes de pesquisar os números em lote.
    setTimeout(() => {
      backfillLeadPhones().catch((err) => console.error("Erro ao buscar número real dos leads:", err));
    }, 3 * 60 * 1000);
  });

  client.on("disconnected", () => {
    status = "DISCONNECTED";
    lastQr = null;
    getIO().emit("whatsapp:status", { status });
  });

  client.on("message", async (msg) => {
    try {
      if (msg.from.endsWith("@g.us")) return; // ignora grupos
      if (msg.from === "status@broadcast") return; // ignora status/stories
      if (msg.fromMe) return;
      const isMediaMsg = msg.type === "image" || msg.type === "document";
      if (!msg.body && !isMediaMsg) return; // ignora mensagens sem texto e sem mídia relevante (figurinha, reação, áudio...)

      const phone = normalizePhone(msg.from);
      const contact = await msg.getContact().catch(() => null);

      // Tenta criar direto e só busca se já existir (não findUnique+create): uma rajada de
      // mensagens do MESMO número novo chegando quase junto (comum ao reconectar depois de um
      // tempo offline) fazia duas mensagens verem "não existe ainda" ao mesmo tempo e as duas
      // tentarem criar o lead, estourando a constraint única de phone na segunda. Deixar o banco
      // decidir (e só cair pro findUnique em caso de conflito real) resolve isso sem essa janela.
      let lead;
      try {
        lead = await prisma.lead.create({
          data: {
            phone,
            name: contact?.pushname || contact?.name || undefined,
            source: "whatsapp",
            conversation: { create: {} },
          },
          include: { conversation: true },
        });
        getIO().emit("lead:created", lead);
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
        lead = await prisma.lead.findUniqueOrThrow({ where: { phone }, include: { conversation: true } });
      }

      const conversation =
        lead.conversation ?? (await prisma.conversation.create({ data: { leadId: lead.id } }));

      // O lead respondeu de verdade — zera o contador de tentativas de reengajamento sem
      // resposta (pra próxima leva de follow-up, se precisar, começar do zero) e marca a
      // conversa como não lida, pra aparecer destacada na aba Conversas até alguém abrir.
      if (conversation.followUpAttempts > 0 || !conversation.unread) {
        const updated = await prisma.conversation.update({
          where: { id: conversation.id },
          data: { followUpAttempts: 0, unread: true },
        });
        getIO().emit("conversation:updated", { id: updated.id, leadId: lead.id, unread: true });
      }

      // A foto/documento vira anexo do lead E fica ligada à mensagem (attachmentId), pra aparecer
      // no próprio chat — antes ela só ia pra aba de anexos e o chat mostrava "📷 Foto enviada".
      const attachment = isMediaMsg
        ? await saveIncomingMedia(msg, lead.id).catch((err) => {
            console.error("Falha ao salvar mídia recebida do WhatsApp:", err);
            return undefined;
          })
        : undefined;

      const content =
        msg.body || (msg.type === "image" ? "📷 Foto enviada" : "📄 Documento enviado");

      const waMessageId = msg.id?._serialized;
      const savedMessage = waMessageId
        ? await prisma.message.upsert({
            where: { waMessageId },
            create: {
              conversationId: conversation.id,
              sender: "LEAD",
              content,
              waMessageId,
              attachmentId: attachment?.id,
            },
            update: {},
            include: { attachment: true },
          })
        : await prisma.message.create({
            data: { conversationId: conversation.id, sender: "LEAD", content, attachmentId: attachment?.id },
            include: { attachment: true },
          });
      getIO().emit("message:new", { leadId: lead.id, message: savedMessage });

      // "SAIR": o lead pediu pra parar. Marca como não contatar, desliga a IA nessa conversa e
      // confirma uma única vez; nenhuma campanha ou reengajamento mexe mais com ele.
      if (!isMediaMsg && isOptOutMessage(msg.body)) {
        await prisma.lead.update({ where: { id: lead.id }, data: { doNotContact: true } });
        const off = await prisma.conversation.update({
          where: { id: conversation.id },
          data: { aiEnabled: false, aiPausedUntil: null },
        });
        getIO().emit("conversation:updated", { id: off.id, leadId: lead.id, aiEnabled: false, aiPausedUntil: null });
        const confirmation = "Tudo certo, você não vai mais receber mensagens nossas. Se mudar de ideia, é só nos chamar. 🙂";
        await sendWhatsAppMessage(phone, confirmation).catch((err) =>
          console.error("Erro ao confirmar o pedido de saída:", err)
        );
        const confirmed = await prisma.message.create({
          data: { conversationId: conversation.id, sender: "AI", content: confirmation },
        });
        getIO().emit("message:new", { leadId: lead.id, message: confirmed });
        return;
      }

      if (isAiActiveNow(conversation)) {
        scheduleAiReply(lead.id, phone);
      }
    } catch (err) {
      console.error("Erro ao processar mensagem recebida do WhatsApp:", err);
    }
  });

  // client.initialize() pode nunca resolver NEM rejeitar (page.goto() aqui dentro é chamado com
  // timeout:0 = infinito) se o Chrome recém-lançado ficar sem CPU pra terminar de carregar a
  // página a tempo (visto na prática: processo vivo, usando CPU, mas o CDP não responde por
  // minutos) — todos os watchdogs existentes (QR parado, "Conectando..." travado) só cobrem
  // DEPOIS que "authenticated" dispara; antes disso, uma trava aqui ficava invisível pra sempre,
  // sem log nenhum e sem nenhuma tentativa de recuperação automática.
  const INIT_TIMEOUT_MS = 90_000;
  const initializingClient = client;

  // Erros dentro da própria página do WhatsApp Web não aparecem em lugar nenhum — quando a conexão
  // trava (ex: sincroniza até 99% e nunca fica pronta), é aqui que a causa aparece. Limitado pra
  // não inundar o log.
  let pageErrorsLogged = 0;
  const attachPageLogging = () => {
    const page = initializingClient.pupPage;
    if (!page) return false;
    initializingClient.pupBrowser
      ?.version()
      .then((v) => console.log(`WhatsApp: navegador ${v}`))
      .catch(() => {});
    page.on("pageerror", (err) => {
      if (pageErrorsLogged++ < 30) console.error("WhatsApp (página): erro:", err instanceof Error ? err.message : err);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error" && pageErrorsLogged++ < 30) console.error("WhatsApp (página): console:", msg.text().slice(0, 500));
    });
    return true;
  };
  const pageLogTimer = setInterval(() => {
    if (attachPageLogging() || client !== initializingClient) clearInterval(pageLogTimer);
  }, 1000);
  const initTimeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`initialize() não respondeu em ${INIT_TIMEOUT_MS}ms`)), INIT_TIMEOUT_MS)
  );

  let initFailed = false;
  const failInit = (err: unknown) => {
    // Só a primeira falha conta, e só se esse client ainda é o atual (não foi trocado por outro).
    if (initFailed || client !== initializingClient) return;
    initFailed = true;
    console.error("Erro ao inicializar o WhatsApp:", err instanceof Error ? err.message : err);
    status = "DISCONNECTED";
    client = null;
    try {
      initializingClient.pupBrowser?.process()?.kill("SIGKILL");
    } catch {
      // processo já pode ter morrido sozinho
    }
    cleanupOrphanChrome();
    getIO().emit("whatsapp:status", { status });
    scheduleInitRetry();
  };

  // O patch do whatsapp-web.js tolera a página do WhatsApp Web recarregar sozinha logo depois de
  // abrir (antes isso derrubava toda tentativa de inicialização) e injeta de novo na página nova —
  // por isso initialize() pode resolver antes de a página estar pronta. Se essa nova injeção falhar,
  // ou se nada acontecer (nem QR, nem login), trata como falha de inicialização em vez de ficar
  // parado pra sempre sem status nenhum.
  (initializingClient as unknown as NodeJS.EventEmitter).on("inject_error", failInit);
  Promise.race([client.initialize(), initTimeout])
    .then(() => {
      setTimeout(() => {
        if (client === initializingClient && status === "DISCONNECTED") {
          failInit(new Error(`página carregou mas não mostrou QR nem conectou em ${INIT_TIMEOUT_MS}ms`));
        }
      }, INIT_TIMEOUT_MS);
    })
    .catch(failInit);
  return client;
}

// O WhatsApp usa sufixos diferentes por tipo de id (@c.us, @lid, etc) e, pra muitos
// números, só o "@lid" resolve de verdade (contas novas do WhatsApp usam esse sistema de
// identidade por padrão). Se o telefone já veio com sufixo (leads criados a partir de
// mensagens reais), usamos como está; se é um número "cru" (ex: lead criado manualmente),
// perguntamos ao próprio WhatsApp qual é o ID certo em vez de chutar "@c.us".
async function toChatId(phone: string): Promise<string> {
  if (phone.includes("@")) return phone;
  if (client) {
    try {
      const wid = await client.getNumberId(phone);
      if (wid?._serialized) return wid._serialized;
    } catch {
      // cai no fallback abaixo
    }
  }
  return `${phone}@c.us`;
}

// Contatos migrados pro sistema LID do WhatsApp aparecem no CRM como "123456789@lid" em vez de um
// telefone de verdade, o que impossibilita achar a conversa pesquisando pelo número no app do
// WhatsApp. Isso usa a mesma função interna que o WhatsApp Web usa (WAWebApiContact.getPhoneNumber)
// pra tentar resolver o telefone real por trás do LID — só funciona se o WhatsApp souber esse
// vínculo (nem sempre disponível, é uma proteção de privacidade da própria plataforma).
export async function resolveRealPhoneNumber(waId: string): Promise<string | null> {
  if (!client || status !== "READY" || !waId.endsWith("@lid")) return null;
  try {
    const evaluate = client.pupPage?.evaluate((lidSerialized: string) => {
      const req = (globalThis as any).require;
      const wid = req("WAWebWidFactory").createWid(lidSerialized);
      if (!wid || wid.server !== "lid") return null;
      const pnWid = req("WAWebApiContact").getPhoneNumber(wid);
      return pnWid?.user ?? null;
    }, waId);
    if (!evaluate) return null;
    // A página do WhatsApp Web às vezes fica com a conexão CDP travada (sem erro, sem resposta —
    // ver instabilidades já documentadas neste arquivo) — sem um timeout aqui, essa chamada trava
    // a requisição HTTP inteira pra sempre em vez de simplesmente falhar.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
    const result = await Promise.race([evaluate, timeout]);
    return result ?? null;
  } catch (err) {
    console.error(`Falha ao resolver telefone real do contato ${waId}:`, err);
    recoverIfFrameDead(err);
    return null;
  }
}

// Quase todo lead chega como @lid (número escondido pelo WhatsApp), então o CRM não sabe o DDD.
// Descobre o número real em lote e guarda em phone2 (só quando vazio, nunca sobrescreve o que a
// equipe digitou) — é dali que o funil tira o DDD pra separar/priorizar a região.
const PHONE_BACKFILL_INTERVAL_MS = 30 * 60 * 1000;
const PHONE_BACKFILL_CHUNK = 200;

async function backfillLeadPhones() {
  if (!client?.pupPage || status !== "READY") return;
  const leads = await prisma.lead.findMany({
    where: { phone: { endsWith: "@lid" }, OR: [{ phone2: null }, { phone2: "" }] },
    select: { id: true, phone: true },
  });
  let filled = 0;
  for (let i = 0; i < leads.length; i += PHONE_BACKFILL_CHUNK) {
    if (!client?.pupPage || status !== "READY") break;
    const chunk = leads.slice(i, i + PHONE_BACKFILL_CHUNK);
    const evaluate = client.pupPage.evaluate((lids: string[]) => {
      const req = (globalThis as any).require;
      return lids.map((lid) => {
        try {
          const wid = req("WAWebWidFactory").createWid(lid);
          if (!wid || wid.server !== "lid") return null;
          return req("WAWebApiContact").getPhoneNumber(wid)?.user ?? null;
        } catch {
          return null;
        }
      });
    }, chunk.map((l) => l.phone));
    // Mesmo motivo do timeout em resolveRealPhoneNumber: a página às vezes para de responder.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000));
    const numbers = await Promise.race([evaluate, timeout]).catch((err) => {
      recoverIfFrameDead(err);
      return null;
    });
    if (!numbers) break;
    for (let j = 0; j < chunk.length; j++) {
      if (!numbers[j]) continue;
      await prisma.lead.update({ where: { id: chunk[j].id }, data: { phone2: numbers[j] } });
      filled++;
    }
  }
  if (filled) {
    console.log(`WhatsApp: número real de ${filled} lead(s) @lid salvo (DDD pro funil)`);
    getIO().emit("leads:phones-updated");
  }
}

export function startLeadPhoneBackfill() {
  setInterval(() => {
    backfillLeadPhones().catch((err) => console.error("Erro ao buscar número real dos leads:", err));
  }, PHONE_BACKFILL_INTERVAL_MS);
}

// client.sendMessage() pode ficar pendurado pra sempre sem nunca resolver nem rejeitar quando o
// contato é um @lid que não existe mais na sessão atual do WhatsApp (ex: leads restaurados de um
// backup antigo, de antes do último login) — mesma classe de trava silenciosa do QR/Conectando,
// só que sem nenhum watchdog cobrindo esse caso: o botão "Enviar" do CRM ficava desabilitado pra
// sempre e nada aparecia nos logs. Esse timeout garante que sempre falha de forma visível.
const SEND_TIMEOUT_MS = 30_000;
function withSendTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout: envio de mensagem (sem resposta em ${SEND_TIMEOUT_MS}ms)`)),
      SEND_TIMEOUT_MS
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// sendSeen: false — por padrão a lib marca a conversa como lida ANTES de mandar, e essa etapa
// espera uma confirmação do servidor do WhatsApp que, nas versões recentes do WhatsApp Web, pode
// nunca chegar: o envio ficava pendurado até o timeout de 30s com o painel mostrando "Conectado"
// e as mensagens recebidas entrando normalmente. Os logs de tempo mostram em qual etapa travou se
// voltar a acontecer.
async function sendThroughWhatsApp(phone: string, content: any, options: Record<string, unknown> = {}) {
  const started = Date.now();
  const chatId = await withSendTimeout(toChatId(phone));
  const resolvedAt = Date.now();
  try {
    await withSendTimeout(client!.sendMessage(chatId, content, { ...options, sendSeen: false }));
    console.log(`WhatsApp: enviado pra ${chatId} (id ${resolvedAt - started}ms, envio ${Date.now() - resolvedAt}ms)`);
  } catch (err) {
    console.error(
      `WhatsApp: envio pra ${chatId} falhou (id ${resolvedAt - started}ms, envio ${Date.now() - resolvedAt}ms):`,
      err instanceof Error ? err.message : err
    );
    // Contatos @lid passaram a falhar na hora com um erro opaco ("r") vindo de dentro do WhatsApp
    // Web, com a conexão funcionando. Registra em qual etapa quebra e tenta pelo número real do
    // contato, quando o WhatsApp sabe qual é.
    if (chatId.endsWith("@lid") && !isFrameDeathError(err) && client) {
      await logLidSendDiagnostic(chatId);
      const realPhone = await resolveRealPhoneNumber(chatId);
      const targets = [chatId, ...(realPhone ? [`${realPhone}@c.us`] : [])];

      // "Lid is missing in chat table": o WhatsApp Web recusa o envio porque trata a conta como já
      // migrada pro LID e a conversa não tem o LID registrado na tabela interna. A correção antiga do
      // whatsapp-web.js (PR #3703, removida depois) era fingir que a conta NÃO migrou. Aqui isso fica
      // ligado só durante a nova tentativa e é desfeito logo depois, pra não mexer no recebimento.
      const overridden = await setLidMigrationOverride(true);
      try {
        for (const target of targets) {
          try {
            await withSendTimeout(client.sendMessage(target, content, { ...options, sendSeen: false }));
            console.log(
              `WhatsApp: enviado pra ${target} na nova tentativa (${overridden ? "com" : "sem"} ajuste de migração LID; o envio normal pra ${chatId} falhou)`
            );
            return;
          } catch (err2) {
            console.error(
              `WhatsApp: nova tentativa pra ${target} (${overridden ? "com" : "sem"} ajuste de migração LID) também falhou:`,
              err2 instanceof Error ? err2.message : err2
            );
          }
        }
      } finally {
        if (overridden) await setLidMigrationOverride(false);
      }
    }
    throw err;
  }
}

// Liga/desliga o "finge que a conta não migrou pro LID" no módulo interno do WhatsApp Web.
// Devolve se conseguiu aplicar (o módulo muda de nome/forma entre versões do WhatsApp Web).
async function setLidMigrationOverride(enabled: boolean): Promise<boolean> {
  try {
    const evaluate = client!.pupPage!.evaluate((on: boolean) => {
      const g = globalThis as any;
      let utils: any;
      try {
        utils = g.require("WAWebLid1X1MigrationGating")?.Lid1X1MigrationUtils;
      } catch {
        return false;
      }
      if (!utils || typeof utils.isLidMigrated !== "function") return false;
      if (on) {
        if (!g.__vmcaOrigIsLidMigrated) g.__vmcaOrigIsLidMigrated = utils.isLidMigrated;
        utils.isLidMigrated = () => false;
      } else if (g.__vmcaOrigIsLidMigrated) {
        utils.isLidMigrated = g.__vmcaOrigIsLidMigrated;
        delete g.__vmcaOrigIsLidMigrated;
      }
      return true;
    }, enabled);
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000));
    const applied = await Promise.race([evaluate, timeout]);
    if (!applied) console.error(`WhatsApp: ajuste de migração LID indisponível nesta versão do WhatsApp Web`);
    return applied;
  } catch (err) {
    console.error("WhatsApp: falha ao aplicar ajuste de migração LID:", err instanceof Error ? err.message : err);
    return false;
  }
}

// O erro que volta da página é só o nome minificado de uma classe interna do WhatsApp Web ("r"),
// sem mensagem. Refaz as etapas iniciais do envio uma a uma, capturando o erro dentro da própria
// página, pra saber qual delas quebra.
async function logLidSendDiagnostic(chatId: string) {
  try {
    const evaluate = client!.pupPage!.evaluate(async (id: string) => {
      const req = (globalThis as any).require;
      const describe = (e: any) => ({
        text: String(e),
        name: e?.name,
        message: e?.message,
        keys: e && typeof e === "object" ? Object.keys(e).slice(0, 10) : [],
        stack: String(e?.stack ?? "").slice(0, 600),
      });
      const out: Record<string, unknown> = {};
      try {
        const wid = req("WAWebWidFactory").createWid(id);
        out.inChatCollection = !!req("WAWebCollections").Chat.get(wid);
        try {
          const res = await req("WAWebFindChatAction").findOrCreateLatestChat(wid);
          out.findChat = res?.chat ? "ok" : "vazio";
        } catch (e) {
          out.findChatError = describe(e);
        }
        try {
          out.phoneNumber = req("WAWebApiContact").getPhoneNumber(wid)?.user ?? null;
        } catch (e) {
          out.phoneNumberError = describe(e);
        }
      } catch (e) {
        out.widError = describe(e);
      }
      return out;
    }, chatId);
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 8000));
    console.error(`WhatsApp: diagnóstico do envio pra ${chatId}:`, JSON.stringify(await Promise.race([evaluate, timeout])));
  } catch (err) {
    console.error(`WhatsApp: diagnóstico do envio pra ${chatId} falhou:`, err instanceof Error ? err.message : err);
  }
}

export async function sendWhatsAppMessage(phone: string, text: string) {
  if (!client || status !== "READY") {
    throw new Error("WhatsApp não está conectado");
  }
  try {
    await sendThroughWhatsApp(phone, text);
  } catch (err) {
    recoverIfFrameDead(err);
    throw err;
  }
}

export async function sendWhatsAppLocation(
  phone: string,
  lat: number,
  lng: number,
  name?: string,
  address?: string
) {
  if (!client || status !== "READY") {
    throw new Error("WhatsApp não está conectado");
  }
  try {
    await sendThroughWhatsApp(phone, new Location(lat, lng, { name, address }));
  } catch (err) {
    recoverIfFrameDead(err);
    throw err;
  }
}

export async function sendWhatsAppAudio(phone: string, buffer: Buffer, mimetype: string) {
  if (!client || status !== "READY") {
    throw new Error("WhatsApp não está conectado");
  }
  const media = new MessageMedia(mimetype, buffer.toString("base64"));
  try {
    await sendThroughWhatsApp(phone, media, { sendAudioAsVoice: true });
  } catch (err) {
    recoverIfFrameDead(err);
    throw err;
  }
}

// "Apagar para todos" — só funciona pra mensagens que a própria loja mandou (agente ou IA), e o
// WhatsApp tem uma janela de tempo pra permitir isso (geralmente até uma hora ou pouco mais).
// Depois desse prazo, o próprio WhatsApp recusa o revoke e essa chamada falha.
export async function deleteWhatsAppMessage(waMessageId: string) {
  if (!client || status !== "READY") {
    throw new Error("WhatsApp não está conectado");
  }
  try {
    const msg = await client.getMessageById(waMessageId);
    if (!msg) throw new Error("Mensagem não encontrada no WhatsApp (pode já ter expirado)");
    await msg.delete(true);
  } catch (err) {
    recoverIfFrameDead(err);
    throw err;
  }
}

export interface ImportSummary {
  chatsProcessed: number;
  leadsCreated: number;
  messagesImported: number;
}

const NON_LEAD_SERVERS = new Set(["g.us", "broadcast", "newsletter", "bot"]);

function isLeadChat(chat: { isGroup?: boolean; id: { server: string; _serialized: string } }) {
  return !chat.isGroup && !NON_LEAD_SERVERS.has(chat.id.server) && chat.id._serialized !== "status@broadcast";
}

export async function importExistingChats(messagesPerChat = 100, sinceDays = 3): Promise<ImportSummary> {
  if (!client || status !== "READY") {
    throw new Error("WhatsApp não está conectado");
  }
  if (importInProgress) {
    throw new Error("Já tem uma importação em andamento, aguarde ela terminar");
  }
  importInProgress = true;
  try {
    return await runImport(client, messagesPerChat, sinceDays);
  } finally {
    importInProgress = false;
  }
}

async function runImport(client: Client, messagesPerChat: number, sinceDays: number): Promise<ImportSummary> {

  const summary: ImportSummary = { chatsProcessed: 0, leadsCreated: 0, messagesImported: 0 };
  const sinceTs = Date.now() / 1000 - sinceDays * 24 * 60 * 60;

  // Caminho rápido: lista só id + timestamp de cada conversa direto na página e filtra as
  // recentes lá dentro, buscando o objeto completo só dessas. client.getChats() serializava TODAS
  // as conversas da conta (com metadados, última mensagem etc.) numa única chamada — numa conta
  // grande isso passava até dos 10 min de protocolTimeout e a importação nunca saía do lugar.
  let chatsToProcess: Awaited<ReturnType<typeof client.getChats>>;
  try {
    const { total, recentIds } = await client.pupPage!.evaluate(
      (sinceTs: number, nonLeadServers: string[]) => {
        const chats = (globalThis as any).require("WAWebCollections").Chat.getModelsArray();
        const recentIds: string[] = [];
        for (const chat of chats) {
          const id = chat.id;
          if (!id || nonLeadServers.includes(id.server) || id._serialized === "status@broadcast") continue;
          if ((chat.t ?? 0) >= sinceTs) recentIds.push(id._serialized);
        }
        return { total: chats.length as number, recentIds };
      },
      sinceTs,
      [...NON_LEAD_SERVERS]
    );
    console.log(
      `WhatsApp tem ${total} conversas, ${recentIds.length} recentes (últimos ${sinceDays} dia(s)) e válidas para importar`
    );
    chatsToProcess = [];
    for (const chatId of recentIds) {
      const chat = await client.getChatById(chatId).catch((err) => {
        if (isFrameDeathError(err)) throw err;
        console.error(`Falha ao buscar chat ${chatId}:`, err.message);
        return undefined;
      });
      if (chat && isLeadChat(chat)) chatsToProcess.push(chat);
    }
  } catch (err) {
    if (isFrameDeathError(err)) throw err;
    console.error("Listagem rápida das conversas falhou, tentando por contato individual:", err);
    let contacts;
    try {
      contacts = await client.getContacts();
    } catch (err2) {
      console.error("Falha em client.getContacts():", err2);
      throw new Error("Não foi possível listar as conversas do WhatsApp");
    }
    const individualContacts = contacts.filter((c) => isLeadChat(c as any));
    console.log(`getContacts() retornou ${contacts.length} contatos, ${individualContacts.length} válidos`);

    chatsToProcess = [];
    for (const contact of individualContacts) {
      const chat = await contact.getChat().catch((err2) => {
        if (isFrameDeathError(err2)) throw err2; // propaga pra parar o loop abaixo
        console.error(`Falha ao buscar chat do contato ${contact.id._serialized}:`, err2.message);
        return null;
      });
      if (chat && (chat.timestamp ?? 0) >= sinceTs) chatsToProcess.push(chat);
    }
  }

  for (const chat of chatsToProcess) {
    try {
      const waId = chat.id._serialized;
      const phone = normalizePhone(waId);

      let lead = await prisma.lead.findUnique({ where: { phone }, include: { conversation: true } });
      if (!lead) {
        lead = await prisma.lead.create({
          data: {
            phone,
            name: chat.name || undefined,
            source: "whatsapp",
            conversation: { create: {} },
          },
          include: { conversation: true },
        });
        summary.leadsCreated++;
        getIO().emit("lead:created", lead);
      }

      const conversation =
        lead.conversation ?? (await prisma.conversation.create({ data: { leadId: lead.id } }));

      const history = await chat.fetchMessages({ limit: messagesPerChat }).catch((err) => {
        console.error(`Falha ao buscar mensagens do chat ${waId}:`, err.message);
        return [];
      });
      for (const msg of history) {
        if (!msg.body) continue;
        const waMessageId = msg.id?._serialized;
        if (waMessageId) {
          const existing = await prisma.message.findUnique({ where: { waMessageId } });
          if (existing) continue;
        }
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            sender: msg.fromMe ? "AGENT" : "LEAD",
            content: msg.body,
            waMessageId,
            createdAt: new Date(msg.timestamp * 1000),
          },
        });
        summary.messagesImported++;
      }

      summary.chatsProcessed++;
    } catch (err) {
      console.error(`Falha ao processar chat ${chat.id?._serialized}:`, err);
      if (isFrameDeathError(err)) {
        console.error("Parando a importação: a página do WhatsApp Web recarregou no meio do processo.");
        break;
      }
    }
  }

  getIO().emit("whatsapp:import-complete", summary);
  return summary;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface CatchUpSummary {
  attempted: number;
  sent: number;
  failed: number;
  // true quando a rotina parou antes de percorrer todo mundo, por falhas demais seguidas —
  // ver MAX_CONSECUTIVE_SEND_FAILURES abaixo.
  stoppedEarly?: boolean;
  // true quando parou porque o limite diário de envios em lote acabou (o resto fica pra amanhã).
  quotaReached?: boolean;
}

// Depois de um certo número de falhas SEGUIDAS (sem nenhum sucesso no meio), para de tentar em
// vez de continuar até o fim da lista. Falhas isoladas acontecem (rede instável, etc.) e não
// devem interromper a rotina — mas uma sequência longa é sinal de problema sistêmico, não
// pontual (ex: um lote inteiro de leads restaurados de um backup antigo, sem chat válido na
// sessão atual do WhatsApp — cada envio trava os 30s de timeout à toa). Sem isso, uma campanha
// pra algumas centenas desses leads ficava rodando por horas sem conseguir mandar nenhuma.
const MAX_CONSECUTIVE_SEND_FAILURES = 5;

const CATCH_UP_INSTRUCTION =
  "Nota interna: essa conversa ficou sem resposta por mais tempo que o normal por um problema técnico nosso. " +
  "Comece a mensagem pedindo desculpas, de forma breve e natural, pela demora — depois siga o atendimento normalmente.";

// Responde leads reais que mandaram mensagem e ainda não tiveram nenhuma resposta (nem da IA, nem manual).
// Envia com um intervalo entre cada mensagem para não parecer automação em massa para o WhatsApp.
export async function catchUpUnanswered(delayMs = 4000): Promise<CatchUpSummary> {
  if (!client || status !== "READY") {
    throw new Error("WhatsApp não está conectado");
  }
  if (await isAiPaused()) {
    throw new Error("A IA está pausada (interruptor geral) — reative antes de responder leads atrasados");
  }

  const conversations = await prisma.conversation.findMany({
    where: aiActiveWhere(),
    include: { lead: true, messages: { orderBy: { createdAt: "asc" } } },
  });

  const pending = conversations.filter(
    (c) =>
      c.lead.phone !== "status@broadcast" &&
      c.messages.length > 0 &&
      !c.messages.some((m) => m.sender === "AI" || m.sender === "AGENT")
  );

  const summary: CatchUpSummary = { attempted: pending.length, sent: 0, failed: 0 };
  let consecutiveFailures = 0;

  for (const conversation of pending) {
    try {
      const reply = await generateAiReply(conversation.leadId, CATCH_UP_INSTRUCTION);
      if (reply) {
        await sendWhatsAppMessage(conversation.lead.phone, reply);
        summary.sent++;
      }
      consecutiveFailures = 0;
    } catch (err) {
      console.error(`Falha ao responder lead atrasado ${conversation.leadId}:`, err);
      summary.failed++;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_SEND_FAILURES) {
        console.error(`Catch-up interrompido: ${MAX_CONSECUTIVE_SEND_FAILURES} falhas seguidas.`);
        summary.stoppedEarly = true;
        break;
      }
    }
    await sleep(delayMs);
  }

  return summary;
}

export interface StalledLeadPreview {
  leadId: string;
  name: string | null;
  phone: string;
  status: string;
  lastMessageAt: string;
}

// Conversas com IA ativa cuja última mensagem (de qualquer lado) foi há mais de `days` dias.
// Usado tanto pra prévia (contar/listar sem enviar nada) quanto pela reativação de verdade.
// onlyOpenLeads (usado pela rodada automática semanal): deixa de fora leads já fechados/perdidos e
// quem já recebeu todas as tentativas (a última é a despedida) — sem isso a automação mandaria
// mensagem toda semana pra lead perdido ou que já ouviu "vamos parar de insistir".
const MAX_FOLLOW_UP_ATTEMPTS = 4;

async function findStalledConversations(days: number, opts: { onlyOpenLeads?: boolean } = {}) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const conversations = await prisma.conversation.findMany({
    where: {
      ...aiActiveWhere(),
      ...(opts.onlyOpenLeads
        ? {
            followUpAttempts: { lt: MAX_FOLLOW_UP_ATTEMPTS },
            lead: { status: { notIn: ["PERDIDO", "GANHO", "FECHADO"] } },
          }
        : {}),
    },
    include: { lead: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  return conversations.filter((c) => {
    if (c.lead.phone === "status@broadcast") return false;
    if (c.lead.doNotContact) return false;
    const last = c.messages[0];
    if (!last) return false; // nunca conversou — fora do escopo desta reativação por inatividade
    return last.createdAt < cutoff;
  });
}

export async function previewStalledLeads(days = 3): Promise<StalledLeadPreview[]> {
  const stalled = await findStalledConversations(days);
  return stalled.map((c) => ({
    leadId: c.leadId,
    name: c.lead.name,
    phone: c.lead.phone,
    status: c.lead.status,
    lastMessageAt: c.messages[0].createdAt.toISOString(),
  }));
}

// Manda uma mensagem de reengajamento pra todo lead com conversa parada há `days` dias,
// com intervalo entre cada envio pra não parecer automação em massa pro WhatsApp.
export async function reengageStalledLeads(
  days = 3,
  delayMs?: number,
  opts: { onlyOpenLeads?: boolean } = {}
): Promise<CatchUpSummary> {
  if (!client || status !== "READY") {
    throw new Error("WhatsApp não está conectado");
  }
  if (await isAiPaused()) {
    throw new Error("A IA está pausada (interruptor geral) — reative antes de reengajar leads");
  }

  const stalled = await findStalledConversations(days, opts);
  const summary: CatchUpSummary = { attempted: stalled.length, sent: 0, failed: 0 };
  let consecutiveFailures = 0;

  for (const conversation of stalled) {
    if ((await remainingToday()) <= 0) {
      summary.quotaReached = true;
      console.log("Reengajamento: limite diário de envios em lote atingido, o resto fica pra outro dia.");
      break;
    }
    try {
      const reply = await generateAiReply(conversation.leadId, undefined, true);
      if (reply) {
        await sendWhatsAppMessage(conversation.lead.phone, reply);
        await recordBroadcastSent();
        summary.sent++;
      }
      consecutiveFailures = 0;
    } catch (err) {
      console.error(`Falha ao reengajar lead parado ${conversation.leadId}:`, err);
      summary.failed++;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_SEND_FAILURES) {
        console.error(`Reengajamento interrompido: ${MAX_CONSECUTIVE_SEND_FAILURES} falhas seguidas.`);
        summary.stoppedEarly = true;
        break;
      }
    }
    await sleep(delayMs ?? randomDelayMs());
  }

  return summary;
}

// Manda a MESMA mensagem, ao pé da letra (sem passar pela IA), pra todo lead num status — e
// move quem recebeu pro status seguinte. Usado pra campanhas manuais tipo "avisa todo mundo em
// Novo que ainda não foi contatado". Intervalo entre envios pra não parecer automação em massa.
export interface CampaignFilters {
  status?: string;
  vehicleBrand?: string;
  minScore?: number;
  maxScore?: number;
  // Só leads cuja ÚLTIMA mensagem foi nossa (IA ou agente) e faz mais de X horas — ou seja, o
  // lead engajou em algum momento mas sumiu depois. Mesma definição da seção "Não engajou" da
  // Rotina do dia.
  awaitingEngagementHours?: number;
}

function buildCampaignWhere(filters: CampaignFilters) {
  return {
    phone: { not: "status@broadcast" },
    doNotContact: false,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.vehicleBrand ? { vehicleBrand: { contains: filters.vehicleBrand } } : {}),
    ...(filters.minScore !== undefined || filters.maxScore !== undefined
      ? {
          score: {
            ...(filters.minScore !== undefined ? { gte: filters.minScore } : {}),
            ...(filters.maxScore !== undefined ? { lte: filters.maxScore } : {}),
          },
        }
      : {}),
  };
}

// Traz os leads que batem com os filtros de status/marca/score — e, se `awaitingEngagementHours`
// estiver setado, filtra ainda mais em memória pra só quem sumiu depois de a última mensagem ter
// sido nossa (não dá pra expressar isso num único `where` do Prisma, precisa olhar a conversa).
async function findCampaignLeads(filters: CampaignFilters) {
  const leads = await prisma.lead.findMany({
    where: buildCampaignWhere(filters),
    include: { conversation: { include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } } } },
  });

  if (filters.awaitingEngagementHours == null) return leads;

  const cutoff = new Date(Date.now() - filters.awaitingEngagementHours * 60 * 60 * 1000);
  return leads.filter((lead) => {
    const last = lead.conversation?.messages[0];
    if (!last) return false;
    return last.sender !== "LEAD" && last.createdAt < cutoff;
  });
}

export async function countCampaignAudience(filters: CampaignFilters): Promise<number> {
  const leads = await findCampaignLeads(filters);
  return leads.length;
}

// Manda a MESMA mensagem, ao pé da letra (sem passar pela IA), pra todo lead que bater com os
// filtros — e opcionalmente move quem recebeu pro status seguinte. Usado pra campanhas manuais
// segmentadas (por status, marca do veículo, faixa de pontuação). Intervalo entre envios pra não
// parecer automação em massa pro WhatsApp.
export async function broadcastFixedMessage(
  filters: CampaignFilters,
  message: string,
  toStatus?: string,
  delayMs?: number,
  onProgress?: (done: number, total: number) => void
): Promise<CatchUpSummary> {
  if (!client || status !== "READY") {
    throw new Error("WhatsApp não está conectado");
  }

  const leads = await findCampaignLeads(filters);
  const summary: CatchUpSummary = { attempted: leads.length, sent: 0, failed: 0 };
  let consecutiveFailures = 0;

  for (const lead of leads) {
    if ((await remainingToday()) <= 0) {
      summary.quotaReached = true;
      console.log("Campanha: limite diário de envios em lote atingido, o resto fica pra outro dia.");
      break;
    }
    try {
      const text = fillTemplate(message, lead);
      await sendWhatsAppMessage(lead.phone, text);
      await recordBroadcastSent();

      const conversation = lead.conversation ?? (await prisma.conversation.create({ data: { leadId: lead.id } }));
      const savedMessage = await prisma.message.create({
        data: { conversationId: conversation.id, sender: "AGENT", content: text },
      });
      getIO().emit("message:new", { leadId: lead.id, message: savedMessage });

      if (toStatus) {
        const updatedLead = await prisma.lead.update({ where: { id: lead.id }, data: { status: toStatus } });
        getIO().emit("lead:updated", updatedLead);
      }

      summary.sent++;
      consecutiveFailures = 0;
    } catch (err) {
      console.error(`Falha ao mandar mensagem em massa pro lead ${lead.id}:`, err);
      summary.failed++;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_SEND_FAILURES) {
        console.error(
          `Campanha interrompida: ${MAX_CONSECUTIVE_SEND_FAILURES} falhas seguidas (${summary.sent} enviadas, ${summary.attempted - summary.sent - summary.failed} não tentadas).`
        );
        summary.stoppedEarly = true;
        break;
      }
    }
    onProgress?.(summary.sent + summary.failed, summary.attempted);
    await sleep(delayMs ?? randomDelayMs());
  }

  return summary;
}

const AUDIT_THRESHOLD_MS = 15 * 60 * 1000;
const AUDIT_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Auditor de atendimento: a cada alguns minutos, procura leads que mandaram mensagem e ficaram
// sem resposta (nem da IA nem de um agente) por tempo demais, e avisa o dono da loja pelo próprio
// WhatsApp. Não repete o aviso pra mesma mensagem parada — só quando ela ainda não tinha sido
// avisada, ou quando o lead manda uma mensagem nova depois de um aviso anterior.
async function checkUnattendedLeads() {
  if (!client || status !== "READY") return;

  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  const auditPhone = settings?.auditPhone;
  if (!auditPhone) return;

  const cutoff = new Date(Date.now() - AUDIT_THRESHOLD_MS);

  const conversations = await prisma.conversation.findMany({
    where: { lead: { phone: { not: "status@broadcast" }, status: { not: "PERDIDO" } } },
    include: {
      lead: { select: { id: true, name: true, phone: true, vehicleInfo: true, vehicleBrand: true, vehicleModel: true, vehicleYear: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const pending = conversations
    .map((conversation) => ({ conversation, last: conversation.messages[0] }))
    .filter(({ conversation, last }) => {
      if (!last || last.sender !== "LEAD" || last.createdAt >= cutoff) return false;
      return !(conversation.auditAlertedAt && conversation.auditAlertedAt >= last.createdAt);
    })
    .sort((a, b) => a.last.createdAt.getTime() - b.last.createdAt.getTime());
  if (pending.length === 0) return;

  // Um aviso só por checagem, com a lista (mais antigo primeiro), em vez de uma mensagem por lead —
  // com vários leads parados o WhatsApp do dono virava uma rajada de avisos.
  const MAX_LISTED = 10;
  const lines = pending.slice(0, MAX_LISTED).map(({ conversation, last }) => {
    const lead = conversation.lead;
    const vehicle =
      [lead.vehicleBrand, lead.vehicleModel, lead.vehicleYear].filter(Boolean).join(" ") ||
      lead.vehicleInfo?.split(",")[0]?.trim() ||
      "";
    const who = [lead.name, vehicle].filter(Boolean).join(" · ") || lead.phone;
    const waitedMin = Math.round((Date.now() - last.createdAt.getTime()) / 60000);
    const waited = waitedMin >= 60 ? `${Math.floor(waitedMin / 60)}h${String(waitedMin % 60).padStart(2, "0")}` : `${waitedMin} min`;
    return `• ${who} — esperando há ${waited}\n  "${last.content.slice(0, 120)}"`;
  });
  const more = pending.length > MAX_LISTED ? `\n…e mais ${pending.length - MAX_LISTED}` : "";
  const alert =
    `⚠️ ${pending.length} lead(s) esperando resposta (veja "Precisa de mim" no CRM):\n\n` + lines.join("\n") + more;

  try {
    await sendWhatsAppMessage(auditPhone, alert);
    await prisma.conversation.updateMany({
      where: { id: { in: pending.map(({ conversation }) => conversation.id) } },
      data: { auditAlertedAt: new Date() },
    });
  } catch (err) {
    console.error("Falha ao mandar aviso do auditor:", err);
  }
}

const AI_RESUME_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Pausas da IA que já venceram (a equipe respondeu e depois parou de mexer na conversa): limpa a
// pausa e, se o lead mandou mensagem nesse meio-tempo e ficou sem resposta, a IA responde agora.
async function resumeExpiredAiPauses() {
  const expired = await prisma.conversation.findMany({
    where: { aiEnabled: true, aiPausedUntil: { lte: new Date() } },
    include: { lead: { select: { id: true, phone: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  for (const conversation of expired) {
    await prisma.conversation.update({ where: { id: conversation.id }, data: { aiPausedUntil: null } });
    getIO().emit("conversation:updated", { id: conversation.id, leadId: conversation.leadId, aiPausedUntil: null });
    if (conversation.messages[0]?.sender === "LEAD" && client && status === "READY") {
      scheduleAiReply(conversation.lead.id, conversation.lead.phone);
    }
  }
}

export function startAiResumeSweep() {
  setInterval(() => {
    resumeExpiredAiPauses().catch((err) => console.error("Erro ao retomar a IA após pausa:", err));
  }, AI_RESUME_CHECK_INTERVAL_MS);
}

export function startLeadAuditor() {
  checkUnattendedLeads().catch((err) => console.error("Erro no auditor de atendimento:", err));
  setInterval(() => {
    checkUnattendedLeads().catch((err) => console.error("Erro no auditor de atendimento:", err));
  }, AUDIT_CHECK_INTERVAL_MS);
}
