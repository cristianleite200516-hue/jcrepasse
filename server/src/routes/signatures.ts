import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { getIO } from "../lib/events";
import { checkMissingFields, buildDocxBuffer, buildFilename } from "../documents/build";
import { convertDocxToPdf } from "../documents/pdf";
import { sendWhatsAppMessage } from "../whatsapp/client";

export const signaturesRouter = Router();

// Fica dentro de .wwebjs_auth (montado no volume persistente do Railway) de propósito: uma
// pasta "uploads" separada, fora do volume, é recriada vazia a cada deploy.
const SIGNATURES_DIR = path.join(__dirname, "..", "..", ".wwebjs_auth", "uploads", "signatures");
fs.mkdirSync(SIGNATURES_DIR, { recursive: true });

const DOC_LABELS: Record<string, string> = {
  PROCURACAO: "Procuração",
  CONTRATO_REPASSE: "Contrato de repasse",
};

// --- Criação do link (autenticado, usado pela equipe dentro do CRM) ---

const createSchema = z.object({
  leadId: z.string().min(1),
  docType: z.enum(["PROCURACAO", "CONTRATO_REPASSE"]),
  sendViaWhatsApp: z.boolean().optional(),
});

signaturesRouter.post("/", requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const lead = await prisma.lead.findUnique({ where: { id: parsed.data.leadId } });
  if (!lead) return res.status(404).json({ error: "Lead não encontrado" });

  const missing = checkMissingFields(parsed.data.docType, lead);
  if (missing.length > 0) {
    return res.status(422).json({ error: "Faltam dados obrigatórios para gerar o documento", missing });
  }

  const docxBuffer = buildDocxBuffer(parsed.data.docType, lead);
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await convertDocxToPdf(docxBuffer);
  } catch (err) {
    console.error("Erro ao converter documento para PDF:", err);
    return res.status(500).json({ error: "Não foi possível gerar o PDF do documento" });
  }

  const token = crypto.randomBytes(24).toString("hex");
  const pdfFile = `${token}.pdf`;
  fs.writeFileSync(path.join(SIGNATURES_DIR, pdfFile), pdfBuffer);

  const signature = await prisma.documentSignature.create({
    data: { leadId: lead.id, token, docType: parsed.data.docType, pdfFile },
  });

  const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  const url = `${clientOrigin}/assinar/${token}`;

  if (parsed.data.sendViaWhatsApp) {
    try {
      await sendWhatsAppMessage(
        lead.phone,
        `Olá! Segue o link pra assinar o(a) ${DOC_LABELS[parsed.data.docType]} do seu veículo: ${url}`
      );
    } catch (err) {
      console.error("Erro ao enviar link de assinatura via WhatsApp:", err);
      return res.status(201).json({ id: signature.id, token, url, whatsappSent: false });
    }
  }

  res.status(201).json({ id: signature.id, token, url, whatsappSent: !!parsed.data.sendViaWhatsApp });
});

signaturesRouter.get("/leads/:leadId", requireAuth, async (req, res) => {
  const signatures = await prisma.documentSignature.findMany({
    where: { leadId: req.params.leadId },
    orderBy: { createdAt: "desc" },
  });
  res.json(signatures);
});

// --- Fluxo público de assinatura (sem autenticação — o signatário não tem login) ---

signaturesRouter.get("/public/:token", async (req, res) => {
  const signature = await prisma.documentSignature.findUnique({
    where: { token: req.params.token },
    include: { lead: { select: { name: true } } },
  });
  if (!signature) return res.status(404).json({ error: "Link de assinatura não encontrado" });

  res.json({
    docType: signature.docType,
    docLabel: DOC_LABELS[signature.docType] ?? signature.docType,
    status: signature.status,
    leadName: signature.lead.name,
    signerName: signature.signerName,
    signedAt: signature.signedAt,
  });
});

signaturesRouter.get("/public/:token/pdf", async (req, res) => {
  const signature = await prisma.documentSignature.findUnique({ where: { token: req.params.token } });
  if (!signature) return res.status(404).end();
  res.setHeader("Content-Type", "application/pdf");
  res.sendFile(path.join(SIGNATURES_DIR, signature.pdfFile));
});

const signSchema = z.object({
  signerName: z.string().trim().min(3, "Digite o nome completo"),
});

signaturesRouter.post("/public/:token/sign", async (req, res) => {
  const parsed = signSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Digite o nome completo pra confirmar" });

  const signature = await prisma.documentSignature.findUnique({ where: { token: req.params.token } });
  if (!signature) return res.status(404).json({ error: "Link de assinatura não encontrado" });
  if (signature.status === "ASSINADO") {
    return res.status(409).json({ error: "Esse documento já foi assinado" });
  }

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "";

  const updated = await prisma.documentSignature.update({
    where: { id: signature.id },
    data: {
      status: "ASSINADO",
      signerName: parsed.data.signerName,
      signerIp: ip,
      signedAt: new Date(),
    },
  });

  getIO().emit("signature:updated", { leadId: signature.leadId, signature: updated });
  res.json({ ok: true });
});
