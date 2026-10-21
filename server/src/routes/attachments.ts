import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { getIO } from "../lib/events";

export const attachmentsRouter = Router();

// Fica dentro de .wwebjs_auth (montado no volume persistente do Railway) de propósito: uma
// pasta "uploads" separada, fora do volume, é recriada vazia a cada deploy — as fotos e
// documentos que os leads mandam somem sozinhos sem nenhum aviso.
const UPLOADS_DIR = path.join(__dirname, "..", "..", ".wwebjs_auth", "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
    cb(null, allowed.includes(file.mimetype));
  },
});

const categorySchema = z.enum(["FOTO", "DOCUMENTO"]);

attachmentsRouter.post(
  "/leads/:leadId/attachments",
  requireAuth,
  upload.array("files", 10),
  async (req, res) => {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.leadId } });
    if (!lead) return res.status(404).json({ error: "Lead não encontrado" });

    const category = categorySchema.safeParse(req.body.category).success
      ? (req.body.category as "FOTO" | "DOCUMENTO")
      : "FOTO";

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) return res.status(400).json({ error: "Nenhum arquivo enviado" });

    const created = await Promise.all(
      files.map((f) =>
        prisma.attachment.create({
          data: {
            leadId: lead.id,
            filename: f.filename,
            originalName: f.originalname,
            mimeType: f.mimetype,
            size: f.size,
            category,
          },
        })
      )
    );

    getIO().emit("attachments:updated", { leadId: lead.id });
    res.status(201).json(created);
  }
);

attachmentsRouter.get("/leads/:leadId/attachments", requireAuth, async (req, res) => {
  const attachments = await prisma.attachment.findMany({
    where: { leadId: req.params.leadId },
    orderBy: { createdAt: "desc" },
  });
  res.json(attachments);
});

// Sem auth de propósito: usado diretamente em <img src> / <a href>, que não enviam
// o header Authorization. O id é um cuid não-adivinhável e o app roda só na rede local.
attachmentsRouter.get("/attachments/:id/file", async (req, res) => {
  const attachment = await prisma.attachment.findUnique({ where: { id: req.params.id } });
  if (!attachment) return res.status(404).end();
  res.setHeader("Content-Type", attachment.mimeType);
  res.sendFile(path.join(UPLOADS_DIR, attachment.filename));
});

attachmentsRouter.delete("/attachments/:id", requireAuth, async (req, res) => {
  const attachment = await prisma.attachment.findUnique({ where: { id: req.params.id } });
  if (!attachment) return res.status(404).json({ error: "Anexo não encontrado" });

  await prisma.attachment.delete({ where: { id: attachment.id } });
  fs.unlink(path.join(UPLOADS_DIR, attachment.filename), () => {});

  getIO().emit("attachments:updated", { leadId: attachment.leadId });
  res.status(204).end();
});
