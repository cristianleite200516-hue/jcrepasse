import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { Server } from "socket.io";
import { setIO } from "./lib/events";
import { startAreaCodeInference } from "./ai/attendant";
import { initWhatsApp, recoverWhatsAppFromCrash, startAiResumeSweep, startLeadAuditor, startLeadPhoneBackfill } from "./whatsapp/client";
import { authRouter } from "./routes/auth";
import { leadsRouter } from "./routes/leads";
import { conversationsRouter } from "./routes/conversations";
import { whatsappRouter } from "./routes/whatsapp";
import { settingsRouter } from "./routes/settings";
import { fipeRouter } from "./routes/fipe";
import { cepRouter } from "./routes/cep";
import { dashboardRouter } from "./routes/dashboard";
import { appointmentsRouter } from "./routes/appointments";
import { remindersRouter } from "./routes/reminders";
import { documentsRouter } from "./routes/documents";
import { dailyRouter } from "./routes/daily";
import { cockpitRouter } from "./routes/cockpit";
import { startAutomations } from "./lib/automations";
import { signaturesRouter } from "./routes/signatures";
import { attachmentsRouter } from "./routes/attachments";
import { backfillContactedLeads } from "./lib/leadStatus";
import { backfillMessageAttachments } from "./lib/attachmentBackfill";

// Permite acessar o CRM tanto por localhost (no próprio Mac) quanto por outro
// dispositivo na mesma rede Wi-Fi (ex: celular acessando pelo IP local do Mac).
const LOCAL_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):\d+$/;

function corsOriginCheck(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
  if (!origin || LOCAL_ORIGIN_REGEX.test(origin) || origin === process.env.CLIENT_ORIGIN) {
    callback(null, true);
  } else {
    callback(new Error("Origem não permitida"));
  }
}

// A biblioteca whatsapp-web.js às vezes lança uma exceção não tratada logo após o
// login ("Execution context was destroyed") por causa de uma corrida interna entre a
// injeção do script dela e uma navegação da página do WhatsApp Web — é um bug conhecido
// da lib, sem relação com o resto do nosso código. Sem isso, ela derrubava o processo
// Node inteiro (API e tudo mais) toda vez que acontecia.
process.on("uncaughtException", (err) => {
  console.error("Exceção não tratada (capturada para não derrubar o servidor):", err);
  recoverWhatsAppFromCrash();
});
process.on("unhandledRejection", (err) => {
  console.error("Rejeição de promise não tratada (capturada para não derrubar o servidor):", err);
  recoverWhatsAppFromCrash();
});

const app = express();
app.use(cors({ origin: corsOriginCheck }));
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/whatsapp", whatsappRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/fipe", fipeRouter);
app.use("/api/cep", cepRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/reminders", remindersRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/daily", dailyRouter);
app.use("/api/cockpit", cockpitRouter);
app.use("/api/signatures", signaturesRouter);
app.use("/api", attachmentsRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOriginCheck },
});
setIO(io);

io.on("connection", (socket) => {
  socket.on("disconnect", () => {});
});

const port = Number(process.env.PORT) || 3001;
server.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);

  // Se já existe uma sessão salva do WhatsApp, reconecta sozinho ao iniciar
  // (sem precisar clicar em "Conectar" nem escanear QR de novo).
  const sessionPath = path.join(__dirname, "..", ".wwebjs_auth", "session");
  if (fs.existsSync(sessionPath)) {
    // Se o processo anterior (reinício do tsx watch, queda, etc.) morreu sem dar tempo do
    // Chrome dele fechar, esse Chrome fica órfão ainda rodando E com o lock do perfil preso
    // (SingletonLock) — aí o Puppeteer se recusa a abrir um Chrome novo ("Failed to launch the
    // browser process!"). Mata qualquer Chrome órfão preso nesse mesmo perfil antes de limpar o
    // lock, pra não correr o risco de dois Chromes usando o mesmo perfil ao mesmo tempo.
    try {
      execFileSync("pkill", ["-9", "-f", sessionPath]);
    } catch {
      // pkill sai com erro quando não acha nenhum processo — não tem órfão mesmo, segue o jogo
    }
    for (const file of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
      fs.rmSync(path.join(sessionPath, file), { force: true });
    }
    console.log("Sessão do WhatsApp encontrada, reconectando automaticamente...");
    initWhatsApp();
  }

  startLeadAuditor();
  startAiResumeSweep();
  startLeadPhoneBackfill();
  startAreaCodeInference();
  startAutomations();
  backfillContactedLeads().catch((err) => console.error("Erro ao acertar status dos leads já respondidos:", err));
  backfillMessageAttachments().catch((err) => console.error("Erro ao ligar fotos antigas às mensagens:", err));
});
