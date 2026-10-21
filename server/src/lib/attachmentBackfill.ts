import { prisma } from "./prisma";

// Fotos/documentos recebidos antes de o chat mostrar mídia foram salvos como anexo do lead mas sem
// ligação com a mensagem ("📷 Foto enviada" aparecia só como texto). O anexo é salvo logo antes da
// mensagem, então liga cada anexo órfão à primeira mensagem do lead sem anexo que chegou nos
// segundos seguintes. Roda a cada boot; depois da primeira vez não acha mais nada pra ligar.
const MATCH_WINDOW_MS = 20_000;

export async function backfillMessageAttachments() {
  const orphans = await prisma.attachment.findMany({
    where: { message: { is: null }, category: { in: ["FOTO", "DOCUMENTO"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, leadId: true, createdAt: true },
  });

  let linked = 0;
  for (const attachment of orphans) {
    const message = await prisma.message.findFirst({
      where: {
        attachmentId: null,
        sender: "LEAD",
        conversation: { leadId: attachment.leadId },
        createdAt: {
          gte: attachment.createdAt,
          lte: new Date(attachment.createdAt.getTime() + MATCH_WINDOW_MS),
        },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!message) continue;
    await prisma.message.update({ where: { id: message.id }, data: { attachmentId: attachment.id } });
    linked++;
  }
  if (linked > 0) console.log(`Chat: ${linked} foto(s)/documento(s) antigos ligados às mensagens`);
}
