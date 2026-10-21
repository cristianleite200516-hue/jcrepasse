import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { checkMissingFields, buildDocxBuffer, buildFilename } from "../documents/build";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

async function handleGenerate(req: any, res: any, docType: "PROCURACAO" | "CONTRATO_REPASSE") {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.leadId } });
  if (!lead) return res.status(404).json({ error: "Lead não encontrado" });

  const missing = checkMissingFields(docType, lead);
  if (missing.length > 0) {
    return res.status(422).json({
      error:
        docType === "PROCURACAO"
          ? "Faltam dados obrigatórios para gerar a procuração"
          : "Faltam dados obrigatórios para gerar o contrato de repasse",
      missing,
    });
  }

  const buffer = buildDocxBuffer(docType, lead);
  const filename = buildFilename(docType, lead);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

documentsRouter.get("/leads/:leadId/procuracao", (req, res) => handleGenerate(req, res, "PROCURACAO"));
documentsRouter.get("/leads/:leadId/contrato-repasse", (req, res) => handleGenerate(req, res, "CONTRATO_REPASSE"));
