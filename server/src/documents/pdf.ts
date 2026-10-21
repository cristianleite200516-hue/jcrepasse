import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Caminho completo porque o processo do servidor (rodando via nohup/tsx watch) nem sempre
// herda o PATH do shell interativo onde o Homebrew foi instalado.
const SOFFICE_CANDIDATES = ["/opt/homebrew/bin/soffice", "/usr/local/bin/soffice", "soffice"];

// Converte um .docx (buffer) em PDF usando o LibreOffice headless — mesmo motor usado por
// vários serviços de assinatura eletrônica pra gerar o PDF que o signatário vê.
export async function convertDocxToPdf(docxBuffer: Buffer): Promise<Buffer> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vmca-doc-"));
  const docxPath = path.join(tmpDir, "documento.docx");
  const pdfPath = path.join(tmpDir, "documento.pdf");

  try {
    fs.writeFileSync(docxPath, docxBuffer);
    let lastErr: unknown;
    for (const soffice of SOFFICE_CANDIDATES) {
      try {
        await execFileAsync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", tmpDir, docxPath], {
          timeout: 30000,
        });
        return fs.readFileSync(pdfPath);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
