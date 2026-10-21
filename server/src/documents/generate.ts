import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

// DOCUMENT_TEMPLATES_DIR permite a outra loja usar os próprios modelos (ex: "templates-jc"), relativo a server/.
const TEMPLATES_DIR = path.join(__dirname, "..", "..", process.env.DOCUMENT_TEMPLATES_DIR || "templates");

// Preenche um modelo .docx (marcadores {como_esse}) com os dados informados e retorna o
// arquivo pronto em memória. Os modelos ficam em server/templates/.
export function generateDocx(templateName: string, data: Record<string, string>): Buffer {
  const templatePath = path.join(TEMPLATES_DIR, templateName);
  const content = fs.readFileSync(templatePath, "binary");
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer" });
}

export function dataExtenso(date: Date = new Date()): string {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}
