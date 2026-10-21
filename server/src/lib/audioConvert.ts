import { spawn } from "child_process";

// Mensagem de voz do WhatsApp precisa ser OGG/Opus. O navegador grava em WebM (Chrome) ou MP4
// (Safari) — mandado assim como voz, no iPhone do lead costuma chegar sem tocar. Converte com o
// ffmpeg (instalado na imagem do servidor); se a conversão falhar, manda o original mesmo.
export async function toOggOpus(buffer: Buffer, mimetype: string): Promise<{ buffer: Buffer; mimetype: string }> {
  if (mimetype.includes("ogg")) return { buffer, mimetype };
  try {
    const converted = await new Promise<Buffer>((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-vn",
        "-ac",
        "1",
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        "-f",
        "ogg",
        "pipe:1",
      ]);
      const chunks: Buffer[] = [];
      let stderr = "";
      const timer = setTimeout(() => {
        ffmpeg.kill("SIGKILL");
        reject(new Error("ffmpeg demorou demais"));
      }, 30_000);
      ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      ffmpeg.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      ffmpeg.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      ffmpeg.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
        else reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(0, 300)}`));
      });
      ffmpeg.stdin.on("error", () => {}); // ffmpeg pode fechar a entrada antes se o arquivo for inválido
      ffmpeg.stdin.end(buffer);
    });
    return { buffer: converted, mimetype: "audio/ogg; codecs=opus" };
  } catch (err) {
    console.error("Falha ao converter áudio pra OGG/Opus, enviando no formato original:", err instanceof Error ? err.message : err);
    return { buffer, mimetype };
  }
}
