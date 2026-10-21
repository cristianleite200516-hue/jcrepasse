import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";

// Restaura o segundo backup: o dev.db que rodava no Mac antes da migração pro Railway (mais
// completo que o primeiro backup restaurado, cobre até 14/09). Só entram leads cujo telefone
// ainda não existe na base (o export já filtrou os que batem com o que tinha em produção no
// momento da exportação, mas o check aqui de novo faz o script seguro de rodar de novo à toa).
const DATA_FILE = path.join(__dirname, "..", "..", "prisma", "backup-full-2026-09-14.json");

interface BackupLead {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  source: string;
  score: number;
  notes: string | null;
  vehicleInfo: string | null;
  askingPrice: string | null;
  urgency: string | null;
  createdAt: number;
  updatedAt: number;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  vehicleKm: number | null;
  fipeValue: string | null;
  fipeCode: string | null;
  purchasePrice: number | null;
  salePrice: number | null;
  fineDebts: number | null;
  ipvaDebt: number | null;
  otherExpenses: number | null;
  prepCost: number | null;
  closedAt: number | null;
  email: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
}

interface BackupConversation {
  id: string;
  leadId: string;
  aiEnabled: number;
  createdAt: number;
  followUpAttempts: number;
  unread: number;
  auditAlertedAt: number | null;
}

interface BackupMessage {
  id: string;
  conversationId: string;
  sender: string;
  content: string;
  waMessageId: string | null;
  attachmentId: string | null;
  createdAt: number;
}

interface BackupAppointment {
  id: string;
  leadId: string;
  scheduledAt: number;
  status: string;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

interface BackupReminder {
  id: string;
  leadId: string;
  dueAt: number;
  note: string | null;
  done: number;
  createdAt: number;
  updatedAt: number;
}

interface BackupAttachment {
  id: string;
  leadId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  category: string;
  createdAt: number;
}

interface BackupData {
  leads: BackupLead[];
  conversations: BackupConversation[];
  messages: BackupMessage[];
  appointments: BackupAppointment[];
  reminders: BackupReminder[];
  attachments: BackupAttachment[];
}

async function main() {
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  const data: BackupData = JSON.parse(raw);

  console.log(
    `Backup carregado: ${data.leads.length} leads, ${data.conversations.length} conversas, ${data.messages.length} mensagens, ${data.appointments.length} agendamentos, ${data.reminders.length} lembretes, ${data.attachments.length} anexos.`
  );

  let leadsCreated = 0;
  let leadsSkipped = 0;
  const restoredLeadIds = new Set<string>();

  for (const lead of data.leads) {
    const existing = await prisma.lead.findUnique({ where: { phone: lead.phone } });
    if (existing) {
      leadsSkipped++;
      continue;
    }
    await prisma.lead.create({
      data: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        status: lead.status,
        source: lead.source,
        score: lead.score,
        notes: lead.notes,
        vehicleInfo: lead.vehicleInfo,
        askingPrice: lead.askingPrice,
        urgency: lead.urgency,
        createdAt: new Date(lead.createdAt),
        updatedAt: new Date(lead.updatedAt),
        vehicleBrand: lead.vehicleBrand,
        vehicleModel: lead.vehicleModel,
        vehicleYear: lead.vehicleYear,
        vehicleKm: lead.vehicleKm,
        fipeValue: lead.fipeValue,
        fipeCode: lead.fipeCode,
        purchasePrice: lead.purchasePrice,
        salePrice: lead.salePrice,
        fineDebts: lead.fineDebts,
        ipvaDebt: lead.ipvaDebt,
        otherExpenses: lead.otherExpenses,
        prepCost: lead.prepCost,
        closedAt: lead.closedAt ? new Date(lead.closedAt) : null,
        email: lead.email,
        city: lead.city,
        state: lead.state,
        address: lead.address,
      },
    });
    restoredLeadIds.add(lead.id);
    leadsCreated++;
  }
  console.log(`Leads: ${leadsCreated} criados, ${leadsSkipped} já existiam (pulados).`);

  let conversationsCreated = 0;
  for (const conv of data.conversations) {
    if (!restoredLeadIds.has(conv.leadId)) continue;
    await prisma.conversation.create({
      data: {
        id: conv.id,
        leadId: conv.leadId,
        aiEnabled: !!conv.aiEnabled,
        createdAt: new Date(conv.createdAt),
        followUpAttempts: conv.followUpAttempts ?? 0,
        unread: !!conv.unread,
      },
    });
    conversationsCreated++;
  }
  console.log(`Conversas criadas: ${conversationsCreated}`);

  const restoredConversationIds = new Set(
    data.conversations.filter((c) => restoredLeadIds.has(c.leadId)).map((c) => c.id)
  );

  // Anexos precisam existir ANTES das mensagens (Message.attachmentId aponta pra cá). O arquivo
  // físico correspondente já deve estar em UPLOADS_DIR (copiado separadamente antes de rodar
  // este script) — se não estiver, a mensagem/anexo ainda é criado no banco, só a exibição no
  // painel é que não vai encontrar o arquivo.
  let attachmentsCreated = 0;
  const restoredAttachmentIds = new Set<string>();
  for (const att of data.attachments) {
    if (!restoredLeadIds.has(att.leadId)) continue;
    try {
      await prisma.attachment.create({
        data: {
          id: att.id,
          leadId: att.leadId,
          filename: att.filename,
          originalName: att.originalName,
          mimeType: att.mimeType,
          size: att.size,
          category: att.category,
          createdAt: new Date(att.createdAt),
        },
      });
      restoredAttachmentIds.add(att.id);
      attachmentsCreated++;
    } catch (err) {
      console.error(`Falha ao criar anexo ${att.id}:`, err);
    }
  }
  console.log(`Anexos criados: ${attachmentsCreated}`);

  let messagesCreated = 0;
  let messagesSkipped = 0;
  for (const msg of data.messages) {
    if (!restoredConversationIds.has(msg.conversationId)) continue;
    try {
      await prisma.message.create({
        data: {
          id: msg.id,
          conversationId: msg.conversationId,
          sender: msg.sender,
          content: msg.content,
          createdAt: new Date(msg.createdAt),
          waMessageId: msg.waMessageId,
          attachmentId: msg.attachmentId && restoredAttachmentIds.has(msg.attachmentId) ? msg.attachmentId : null,
        },
      });
      messagesCreated++;
    } catch (err) {
      // Provável conflito de unicidade (waMessageId ou attachmentId já usado) — pula essa
      // mensagem específica em vez de derrubar a restauração inteira.
      messagesSkipped++;
      console.error(`Falha ao criar mensagem ${msg.id} (pulando):`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`Mensagens: ${messagesCreated} criadas, ${messagesSkipped} puladas.`);

  let appointmentsCreated = 0;
  for (const appt of data.appointments) {
    if (!restoredLeadIds.has(appt.leadId)) continue;
    await prisma.appointment.create({
      data: {
        id: appt.id,
        leadId: appt.leadId,
        scheduledAt: new Date(appt.scheduledAt),
        status: appt.status,
        notes: appt.notes,
        createdAt: new Date(appt.createdAt),
        updatedAt: new Date(appt.updatedAt),
      },
    });
    appointmentsCreated++;
  }
  console.log(`Agendamentos criados: ${appointmentsCreated}`);

  let remindersCreated = 0;
  for (const rem of data.reminders) {
    if (!restoredLeadIds.has(rem.leadId)) continue;
    await prisma.reminder.create({
      data: {
        id: rem.id,
        leadId: rem.leadId,
        dueAt: new Date(rem.dueAt),
        note: rem.note,
        done: !!rem.done,
        createdAt: new Date(rem.createdAt),
        updatedAt: new Date(rem.updatedAt),
      },
    });
    remindersCreated++;
  }
  console.log(`Lembretes criados: ${remindersCreated}`);

  console.log("Restauração concluída.");
}

main()
  .catch((err) => {
    console.error("Erro na restauração:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
