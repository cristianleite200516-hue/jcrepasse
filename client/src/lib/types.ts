export type LeadStatus = "NOVO" | "CONTATADO" | "QUALIFICADO" | "PROPOSTA" | "GANHO" | "FECHADO" | "PERDIDO";

export const LEAD_STATUSES: LeadStatus[] = [
  "NOVO",
  "CONTATADO",
  "QUALIFICADO",
  "PROPOSTA",
  "GANHO",
  "FECHADO",
  "PERDIDO",
];

export const STATUS_LABELS: Record<LeadStatus, string> = {
  NOVO: "Novo",
  CONTATADO: "Contatado",
  QUALIFICADO: "Qualificado",
  PROPOSTA: "Proposta",
  GANHO: "Ganho",
  FECHADO: "Fechado",
  PERDIDO: "Perdido",
};

export interface Lead {
  id: string;
  name: string | null;
  phone: string;
  status: LeadStatus;
  lossReason: string | null;
  source: string;
  score: number;
  notes: string | null;
  vehicleInfo: string | null;
  askingPrice: string | null;
  urgency: string | null;
  assignedToId: string | null;
  assignedTo: { id: string; name: string } | null;
  email: string | null;
  address: string | null;
  addressComplement: string | null;
  cep: string | null;
  city: string | null;
  state: string | null;
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
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  nextAppointment: { id: string; scheduledAt: string; status: AppointmentStatus } | null;

  cpf: string | null;
  rg: string | null;
  nationality: string | null;
  profession: string | null;
  phone2: string | null;

  vehiclePlate: string | null;
  vehicleChassi: string | null;
  vehicleRenavam: string | null;
  vehicleColor: string | null;
  vehicleFuel: string | null;
  vehicleCategory: string | null;
  vehicleSituation: string | null;
  vehicleCity: string | null;
  vehicleState: string | null;
  vehicleLienBank: string | null;

  buyerName: string | null;
  buyerCpf: string | null;
  buyerRg: string | null;
  buyerNationality: string | null;
  buyerProfession: string | null;
  buyerPhone: string | null;
  buyerEmail: string | null;
  buyerAddress: string | null;
  buyerNeighborhood: string | null;
  buyerCep: string | null;
  buyerCity: string | null;
  buyerState: string | null;

  saleOperationalFee: number | null;
  saleAssumedDebts: number | null;
  deliveryDate: string | null;
  deliveryTime: string | null;
  deliveryManual: boolean;
  deliveryKey: boolean;
  deliveryProcuracao: boolean;
  deliveryDut: boolean;
  witness1Name: string | null;
  witness1Cpf: string | null;
  witness2Name: string | null;
  witness2Cpf: string | null;

  resaleStatus: ResaleStatus;
  soldAt: string | null;
  purchasedBy: string | null;
  soldBy: string | null;
  channel: LeadChannel | null;
}

export const TEAM_NAMES = ["Felipe Proença", "Pilo", "Matheus"];

export type LeadChannel = "TRAFEGO_PAGO" | "INDICACAO" | "OUTRO";

export const LEAD_CHANNELS: LeadChannel[] = ["TRAFEGO_PAGO", "INDICACAO", "OUTRO"];

export const CHANNEL_LABELS: Record<LeadChannel, string> = {
  TRAFEGO_PAGO: "Tráfego pago",
  INDICACAO: "Indicação",
  OUTRO: "Outro canal",
};

export type ResaleStatus = "EM_ESTOQUE" | "ANUNCIADO" | "NEGOCIANDO" | "VENDIDO";

export const RESALE_STATUSES: ResaleStatus[] = ["EM_ESTOQUE", "ANUNCIADO", "NEGOCIANDO", "VENDIDO"];

export const RESALE_STATUS_LABELS: Record<ResaleStatus, string> = {
  EM_ESTOQUE: "Em estoque",
  ANUNCIADO: "Anunciado",
  NEGOCIANDO: "Negociando",
  VENDIDO: "Vendido",
};

export interface Message {
  id: string;
  conversationId: string;
  sender: "LEAD" | "AI" | "AGENT";
  content: string;
  createdAt: string;
  attachmentId?: string | null;
  attachment?: { id: string; mimeType: string; category: AttachmentCategory } | null;
}

export interface Conversation {
  id: string;
  leadId: string;
  aiEnabled: boolean;
  // IA pausada até essa hora porque alguém da equipe respondeu; depois volta sozinha.
  aiPausedUntil?: string | null;
  createdAt: string;
  messages: Message[];
}

export interface LeadWithConversation extends Lead {
  conversation: Conversation | null;
}

export interface ConversationSummary {
  id: string;
  leadId: string;
  aiEnabled: boolean;
  aiPausedUntil?: string | null;
  unread: boolean;
  lead: {
    id: string;
    name: string | null;
    phone: string;
    status: LeadStatus;
    vehicleBrand?: string | null;
    vehicleModel?: string | null;
    vehicleYear?: string | null;
    vehicleInfo?: string | null;
  };
  lastMessage: Message | null;
}

export type AppointmentStatus = "AGENDADO" | "CONFIRMADO" | "REALIZADO" | "CANCELADO";

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  AGENDADO: "Agendado",
  CONFIRMADO: "Confirmado",
  REALIZADO: "Realizado",
  CANCELADO: "Cancelado",
};

export interface AppointmentLead {
  id: string;
  name: string | null;
  phone: string;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  vehicleInfo: string | null;
}

export type AttachmentCategory = "FOTO" | "DOCUMENTO" | "AUDIO";

export interface Attachment {
  id: string;
  leadId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  category: AttachmentCategory;
  createdAt: string;
}

export interface Appointment {
  id: string;
  leadId: string;
  lead: AppointmentLead;
  scheduledAt: string;
  status: AppointmentStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Reminder {
  id: string;
  leadId: string;
  lead: AppointmentLead;
  dueAt: string;
  note: string | null;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DocType = "PROCURACAO" | "CONTRATO_REPASSE";

export interface DocumentSignature {
  id: string;
  leadId: string;
  token: string;
  docType: DocType;
  status: "PENDENTE" | "ASSINADO";
  signerName: string | null;
  signerIp: string | null;
  signedAt: string | null;
  createdAt: string;
}

export interface QuickReply {
  title: string;
  text: string;
}

// A IA vai responder essa conversa sozinha agora? (não desligada e não pausada pela equipe)
export function isAiActiveNow(conversation: { aiEnabled: boolean; aiPausedUntil?: string | null }) {
  return (
    conversation.aiEnabled &&
    (!conversation.aiPausedUntil || new Date(conversation.aiPausedUntil).getTime() <= Date.now())
  );
}
