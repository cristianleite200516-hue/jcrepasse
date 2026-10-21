import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";

// Restaura o backup local de 2026-08-24 (SQLite, de antes da migração pro Postgres no Railway)
// que nunca foi trazido pro banco novo. Roda uma única vez via Railway Console. É seguro rodar
// de novo por engano: pula qualquer lead cujo telefone já exista na base.
const DATA_FILE = path.join(__dirname, "..", "..", "prisma", "backup-2026-08-24.json");

interface BackupLead {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  source: string;
  score: number;
  notes: string | null;
  assignedToId: string | null;
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
}

interface BackupMessage {
  id: string;
  conversationId: string;
  sender: string;
  content: string;
  createdAt: number;
  waMessageId: string | null;
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

interface BackupData {
  leads: BackupLead[];
  conversations: BackupConversation[];
  messages: BackupMessage[];
  appointments: BackupAppointment[];
}

async function main() {
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  const data: BackupData = JSON.parse(raw);

  console.log(
    `Backup carregado: ${data.leads.length} leads, ${data.conversations.length} conversas, ${data.messages.length} mensagens, ${data.appointments.length} agendamentos.`
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
    if (!restoredLeadIds.has(conv.leadId)) continue; // lead pulado (telefone já existia) -> pula a conversa também
    await prisma.conversation.create({
      data: {
        id: conv.id,
        leadId: conv.leadId,
        aiEnabled: !!conv.aiEnabled,
        createdAt: new Date(conv.createdAt),
      },
    });
    conversationsCreated++;
  }
  console.log(`Conversas criadas: ${conversationsCreated}`);

  let messagesCreated = 0;
  const restoredConversationIds = new Set(data.conversations.filter((c) => restoredLeadIds.has(c.leadId)).map((c) => c.id));
  for (const msg of data.messages) {
    if (!restoredConversationIds.has(msg.conversationId)) continue;
    await prisma.message.create({
      data: {
        id: msg.id,
        conversationId: msg.conversationId,
        sender: msg.sender,
        content: msg.content,
        createdAt: new Date(msg.createdAt),
        waMessageId: msg.waMessageId,
      },
    });
    messagesCreated++;
  }
  console.log(`Mensagens criadas: ${messagesCreated}`);

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

  console.log("Restauração concluída.");
}

main()
  .catch((err) => {
    console.error("Erro na restauração:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
