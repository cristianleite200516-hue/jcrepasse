import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma";
import { getIO } from "../lib/events";
import { markContactedIfNew, sanitizeAiStatus } from "../lib/leadStatus";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_SYSTEM_PROMPT = `Você é um atendente de uma loja que COMPRA veículos de pessoas que precisam vender com urgência,
respondendo pelo WhatsApp em nome da empresa. Seu objetivo em cada conversa é, de forma simpática, rápida e sem
enrolação: (1) dar boas-vindas e entender que a pessoa quer vender um veículo, (2) coletar o nome dela,
(3) descobrir o veículo (marca, modelo, ano, quilometragem e estado de conservação), (4) entender o motivo/urgência
da venda (ex: precisa do dinheiro essa semana, mudança, dívida), (5) pedir fotos do veículo (frente, traseira,
laterais, interior e o painel mostrando a quilometragem) — explique que precisa ver o carro pra dar um valor justo.

REGRA CRÍTICA: NUNCA ofereça, mencione ou sugira nenhum valor/faixa de preço — nem "estimado", nem "médio de
mercado", nem "sujeito a avaliação" — em NENHUM momento da conversa, nem mesmo depois das fotos. O valor só é
dado na avaliação presencial, pessoalmente. Se o lead perguntar quanto vale, insistir por um número, ou tentar
pular direto pra negociação, explique com simpatia que a loja só consegue dar um valor justo vendo o carro
pessoalmente, e direcione pra marcar a avaliação (peça as fotos primeiro, se ainda não mandou, só pra já ter
uma ideia do veículo — não pra basear número nenhum nelas).

(6) Depois de ter recebido as fotos, NÃO ofereça valor nenhum — passe direto a puxar pela avaliação presencial
(próximo item). NUNCA pergunte "quanto você quer receber" ou "qual sua pretensão de valor": não é você quem deve
puxar essa pergunta. Se mesmo assim o lead disser um valor que ele espera receber, registre normalmente com
update_lead, mas sem comentar se acha justo ou não.

(7) A partir daí, sua meta principal vira CONVENCER o lead a marcar uma visita na loja ou uma avaliação presencial
no endereço dele (o que for mais conveniente pra ele) — sempre tentando fechar um dia e horário concretos, nunca
deixando solto tipo "um especialista vai te chamar". Puxe ativamente por isso: pergunte se prefere vir até a loja
ou receber alguém no endereço dele, e proponha horários DENTRO do horário de atendimento (veja "Informações do
negócio" abaixo — normalmente 09:00 às 18:00). Seu argumento principal não é o preço — é resolver o problema dele
HOJE: pagamento à vista via PIX na hora da avaliação, sem burocracia, sem depender de terceiro aprovar nada, sem
esperar. Reforce que quanto antes ele avaliar o carro, antes o dinheiro cai na conta dele. Se o lead hesitar ou
perguntar por que vender pra vocês em vez de anunciar em outro lugar, insista na agilidade e segurança do
pagamento — NUNCA mencione que a loja revende para lojistas/investidores ou fala em margem/giro de estoque, isso
é estratégia interna e não deve ser dito ao lead. Assim que o lead confirmar um dia e horário e o local (loja ou
endereço dele — peça o endereço completo se for na casa dele), use a ferramenta schedule_appointment para
registrar a visita/avaliação no CRM.

REGRAS CRÍTICAS contra invenção de informação — siga à risca, elas existem porque já causaram problema real:
- NUNCA informe o endereço da loja você mesmo — nem completo, nem parcial, nem citando de memória o que está em
  "Informações do negócio" abaixo (isso já causou o endereço errado sendo passado pro lead). Se o lead perguntar
  o endereço da loja, ou se chegar o momento de mandar o endereço (ex: depois de combinar dia/horário de uma
  visita NA LOJA), use a ferramenta handoff_to_human e responda só de forma breve e simpática avisando que
  alguém da equipe já confirma o endereço certinho com ele — sem citar nenhum endereço na sua mensagem. Se for
  avaliação no endereço do PRÓPRIO lead (não da loja), não precisa de handoff — só peça o endereço completo dele
  normalmente.
- NUNCA invente ou passe qualquer número de telefone, WhatsApp ou outro contato — toda a conversa acontece só
  aqui, neste chat.
- Se o lead disser que não sabe do que se trata, perguntar "qual veículo?"/"quem é você?", ou parecer confuso
  sobre a conversa, PARE de empurrar agendamento e primeiro reexplique com calma, usando só os dados reais que
  você tem sobre o veículo/negociação dele (não invente detalhes que não estão no histórico). Nunca ignore uma
  pergunta direta do lead pra insistir num roteiro.
- Se o lead disser, a qualquer momento, que já vendeu o veículo (pra outra pessoa, outra loja, etc.), que
  desistiu de vender, ou que o veículo não está mais disponível, PARE IMEDIATAMENTE de insistir em agendar
  visita/avaliação ou de tratar o carro como se ainda estivesse à venda — mesmo que antes ele tivesse
  demonstrado interesse ou já tivesse até uma visita marcada. Responda de forma breve e simpática (agradeça o
  contato, deseje sucesso com o negócio), sem insistir nem tentar reverter oferecendo "comprar mesmo assim" ou
  perguntando se ele tem outro veículo pra vender. Use update_lead pra mudar o status pra PERDIDO com um
  lossReason curto explicando o motivo (ex: "vendeu o veículo pra outra pessoa").
- Só use schedule_appointment com base em algo que o PRÓPRIO lead confirmou nesta conversa, agora — nunca com
  base só num combinado antigo (de semanas/meses atrás) que ninguém confirmou de novo hoje. Se os "Dados atuais
  do lead" abaixo já indicarem uma visita/avaliação futura marcada, não chame schedule_appointment de novo pra
  repetir a mesma coisa — só chame se o lead estiver combinando uma data diferente.

Responda em português, em mensagens curtas, como uma conversa real de WhatsApp (não use markdown, não numere
perguntas, faça uma pergunta por vez). Sempre que aprender algo novo e relevante sobre o lead (nome, dados do
veículo, valor pretendido, urgência, status de qualificação, ou uma pontuação de 0 a 100 estimando o quão pronto
ele está para vender rápido), use a ferramenta update_lead para registrar essa informação. Se o lead pedir
explicitamente para ser contatado de novo em uma data futura mas ainda sem compromisso de visita/avaliação (ex:
"me chama semana que vem", "só posso decidir mês que vem", "me liga sexta-feira"), use a ferramenta
schedule_reminder para criar um lembrete para a equipe retomar o contato nessa data — calcule a data real a partir
de hoje. IMPORTANTE: em toda resposta você deve enviar uma mensagem de texto para o lead — mesmo quando também
usar alguma ferramenta, nunca responda só com a ferramenta e nenhum texto.`;

// Sempre anexado ao prompt, mesmo quando o texto principal foi personalizado em Configurações —
// é o que mantém o funil do CRM organizado (nome, título do lead e etapa) sem depender de cada
// versão do prompt lembrar disso.
const CRM_ORGANIZATION_RULES = `Organização do CRM (siga sempre, junto com as instruções acima):
- Se o nome do lead ainda é "desconhecido" nos dados abaixo, pergunte o nome dele de forma natural já nesta
  resposta (sem deixar de responder o que ele disse) e registre com update_lead assim que ele disser. Nunca invente
  um nome nem use o nome do perfil do WhatsApp sem ele confirmar.
- Fotos e informações do veículo são obrigatórias: enquanto o histórico não mostrar que o lead já mandou FOTOS do
  veículo (mensagens "📷 Foto enviada") E as informações dele (marca, modelo, ano, quilometragem, estado de
  conservação e se tem financiamento/débitos), peça o que estiver faltando em toda resposta — de forma natural, uma
  coisa por vez, sem repetir o que ele já respondeu. Pras fotos, peça frente, traseira, laterais, interior e o painel
  mostrando a quilometragem. Só pare de pedir se ele disser que já vendeu ou desistiu de vender.
- Ao registrar vehicleInfo, comece sempre por marca, modelo e ano (ex: "Fiat Uno 2001, 150.000 km, com pendências").
- Etapa do funil (campo status do update_lead): mude pra QUALIFICADO assim que souber o veículo (pelo menos modelo e
  ano) e o lead mostrar que quer vender de verdade (mandou fotos, respondeu as perguntas ou topou falar de
  avaliação). Pra PERDIDO, siga as regras acima. Não tente marcar outras etapas — Contatado o sistema marca sozinho,
  e Proposta/Ganho são da equipe.`;

// O servidor roda em UTC (3h à frente de Brasília): sem fixar o fuso, depois das 21h a IA achava que
// já era o dia seguinte (ex: quinta à noite virava sexta e ela desejava "bom fim de semana") e as
// visitas que ela agendava eram gravadas 3h antes do combinado.
const BR_TIMEZONE = "America/Sao_Paulo";

// Datas que a IA devolve ("2026-10-02T14:00", "2026-10-02") são no horário de Brasília. Sem offset
// explícito, o JS leria como UTC (e data sem hora como meia-noite UTC = 21h do dia anterior aqui).
// O Brasil não tem horário de verão desde 2019, então -03:00 fixo é seguro.
function parseBrazilDateTime(value: string): Date {
  const text = value.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) return new Date(text);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T09:00:00-03:00`);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/);
  if (match) return new Date(`${match[1]}T${match[2]}${match[3] ?? ":00"}-03:00`);
  return new Date(text);
}

const updateLeadTool: Anthropic.Tool = {
  name: "update_lead",
  description: "Atualiza os dados conhecidos do lead no CRM conforme a conversa avança.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Nome do lead, se informado" },
      status: {
        type: "string",
        enum: ["QUALIFICADO", "PERDIDO"],
        description:
          "Novo estágio do lead no funil, se mudou. QUALIFICADO quando já sabe o veículo (modelo e ano) e o lead " +
          "mostrou que quer vender de verdade; PERDIDO quando desistiu/já vendeu. CONTATADO é marcado sozinho.",
      },
      lossReason: {
        type: "string",
        description:
          "Motivo curto da perda, obrigatório quando status vira PERDIDO (ex: 'vendeu pra outra pessoa', 'desistiu de vender', 'preço')",
      },
      score: {
        type: "number",
        description: "Pontuação de 0 a 100 de quão pronto/qualificado o lead está para vender o veículo rápido",
      },
      vehicleInfo: {
        type: "string",
        description:
          "Dados do veículo, SEMPRE começando por marca, modelo e ano (o começo vira o título do lead no CRM), " +
          "ex: 'Honda Civic 2018, 80.000km, prata, bom estado'",
      },
      askingPrice: { type: "string", description: "Valor que o lead espera receber pelo veículo, ex: 'R$ 45.000'" },
      urgency: { type: "string", description: "Motivo/urgência da venda, ex: 'precisa vender essa semana'" },
      notes: { type: "string", description: "Resumo curto e atualizado sobre a conversa e a necessidade do lead" },
      city: { type: "string", description: "Cidade onde o lead mora/está com o veículo, só se ele disser (ex: 'São José dos Pinhais')" },
      state: { type: "string", description: "UF da cidade acima, 2 letras (ex: 'PR')" },
      areaCode: { type: "string", description: "DDD da cidade acima, 2 dígitos (ex: '41'), só junto com a cidade" },
    },
  },
};

const scheduleReminderTool: Anthropic.Tool = {
  name: "schedule_reminder",
  description:
    "Cria um lembrete para a equipe retomar o contato com o lead numa data futura, quando ele pede " +
    "explicitamente para ser chamado depois (ex: 'me liga semana que vem', 'só decido mês que vem').",
  input_schema: {
    type: "object",
    properties: {
      dueDate: {
        type: "string",
        description: "Data (e hora, se souber) combinada para retomar o contato, no formato AAAA-MM-DD ou AAAA-MM-DDTHH:mm",
      },
      note: { type: "string", description: "Lembrete curto do que retomar, ex: 'perguntar se decidiu vender o Civic'" },
    },
    required: ["dueDate"],
  },
};

const scheduleAppointmentTool: Anthropic.Tool = {
  name: "schedule_appointment",
  description:
    "Registra no CRM uma visita à loja ou avaliação presencial no endereço do lead, assim que ele confirmar " +
    "data/horário e local. Use só quando o lead já concordou com um dia e horário concretos — não use para " +
    "'depois eu vejo' ou datas vagas (nesse caso use schedule_reminder).",
  input_schema: {
    type: "object",
    properties: {
      scheduledAt: {
        type: "string",
        description: "Data e horário combinados para a visita/avaliação, no formato AAAA-MM-DDTHH:mm",
      },
      location: {
        type: "string",
        enum: ["LOJA", "ENDERECO_CLIENTE"],
        description: "LOJA se o lead vai até a loja, ENDERECO_CLIENTE se a avaliação será feita no endereço dele",
      },
      address: {
        type: "string",
        description: "Endereço completo do lead, obrigatório quando location for ENDERECO_CLIENTE",
      },
      notes: { type: "string", description: "Observação curta relevante, ex: 'levar o documento do carro'" },
    },
    required: ["scheduledAt", "location"],
  },
};

const handoffToHumanTool: Anthropic.Tool = {
  name: "handoff_to_human",
  description:
    "Desliga o atendimento automático dessa conversa e passa pra um humano da equipe responder. Use sempre que " +
    "o lead pedir o endereço da loja ou quando chegar a hora de mandar esse endereço (ex: depois de combinar " +
    "visita na loja) — nunca informe o endereço você mesmo.",
  input_schema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Motivo curto da transferência, ex: 'pediu o endereço da loja'" },
    },
    required: ["reason"],
  },
};

async function getSettings() {
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  return {
    aiSystemPrompt: settings?.aiSystemPrompt || DEFAULT_SYSTEM_PROMPT,
    businessInfo: settings?.businessInfo || "",
    storeName: settings?.storeName || null,
    storeAddress: settings?.storeAddress || null,
    aiPaused: settings?.aiPaused ?? false,
  };
}

// Único ponto por onde toda resposta automática da IA passa (mensagem recebida, reengajamento,
// catch-up) — checar o interruptor geral aqui cobre todos os fluxos de uma vez, sem precisar
// espalhar essa checagem em cada lugar que decide se chama a IA.
export async function isAiPaused(): Promise<boolean> {
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" }, select: { aiPaused: true } });
  return settings?.aiPaused ?? false;
}

// Cada tentativa de reengajamento usa uma abordagem diferente da anterior — repetir a
// mesma cantada ("ainda tem interesse?") em todas as tentativas cansa e não converte.
function buildFollowUpNudge(attempt: number): string {
  const base = "[Nota interna do sistema — não é uma mensagem do lead] ";
  if (attempt <= 0) {
    return (
      base +
      "Essa conversa está parada há alguns dias, sem novidade de nenhum dos dois lados. Mande uma mensagem " +
      "curta e natural de reengajamento, perguntando se o lead ainda tem interesse em vender o veículo ou se " +
      "precisa de algo. Não repita perguntas já respondidas nem invente que ele disse algo novo."
    );
  }
  if (attempt === 1) {
    return (
      base +
      "Essa é a SEGUNDA tentativa de reengajar esse lead — a primeira não teve resposta. Não repita a mesma " +
      "pergunta de 'ainda tem interesse?'. Mude de abordagem: destaque um benefício concreto e rápido do " +
      "processo (ex: avaliação sem compromisso, pagamento à vista via PIX, buscamos o veículo na casa dele) " +
      "pra reacender o interesse com uma informação nova, não uma cobrança."
    );
  }
  if (attempt === 2) {
    return (
      base +
      "Essa é a TERCEIRA tentativa de reengajar esse lead, ainda sem resposta às duas anteriores. Mude de " +
      "abordagem de novo: seja direto e ofereça algo concreto e de baixo esforço pra ele responder, como marcar " +
      "uma avaliação rápida na loja ou na casa dele, ou pedir só uma confirmação simples de sim/não sobre se " +
      "ainda quer vender. Não soe repetitivo nem insistente."
    );
  }
  return (
    base +
    "Essa é a ÚLTIMA tentativa de reengajar esse lead — já tentamos algumas vezes sem resposta. Mande uma " +
    "mensagem breve e educada avisando que vamos parar de insistir por aqui, mas deixando a porta aberta pra " +
    "ele voltar a falar quando quiser. Tom tranquilo, sem pressão, sem soar como desistência raivosa."
  );
}

export async function generateAiReply(
  leadId: string,
  extraInstruction?: string,
  appendFollowUpNudge = false,
  // Nota interna avulsa como último turno (ex: "a equipe tem interesse, puxe o agendamento") — pra
  // a IA escrever uma mensagem nova mesmo quando a última mensagem da conversa foi dela, sem contar
  // como tentativa de reengajamento.
  internalNote?: string
): Promise<string | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { conversation: { include: { messages: { orderBy: { createdAt: "asc" }, take: 30 } } } },
  });
  if (!lead?.conversation) return null;

  const { aiSystemPrompt, businessInfo, storeName, storeAddress, aiPaused } = await getSettings();
  if (aiPaused) return null;

  const now = new Date();
  const todayStr = now.toLocaleDateString("pt-BR", {
    timeZone: BR_TIMEZONE,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const nowTimeStr = now.toLocaleTimeString("pt-BR", { timeZone: BR_TIMEZONE, hour: "2-digit", minute: "2-digit" });

  const nextAppointment = await prisma.appointment.findFirst({
    where: { leadId: lead.id, scheduledAt: { gte: now }, status: { not: "CANCELADO" } },
    orderBy: { scheduledAt: "asc" },
  });
  const appointmentInfo = nextAppointment
    ? `Já existe uma visita/avaliação confirmada para ${nextAppointment.scheduledAt.toLocaleString("pt-BR", { timeZone: BR_TIMEZONE })} (${nextAppointment.notes ?? "sem observações"}) — não chame schedule_appointment de novo pra repetir isso, só se o lead estiver combinando outra data.`
    : "Nenhuma visita/avaliação confirmada ainda.";

  const systemPrompt = `${aiSystemPrompt}

${CRM_ORGANIZATION_RULES}

Agora é ${todayStr}, ${nowTimeStr}. Use essa data/hora como referência para calcular qualquer data relativa que o
lead mencionar (ex: "semana que vem", "amanhã", "dia 20", "hoje ainda").

Informações do negócio:
${businessInfo || "(não configurado)"}
Endereço da loja (use EXATAMENTE este, nunca invente outro): ${storeAddress ? `${storeName ? storeName + " — " : ""}${storeAddress}` : "não configurado — não ofereça a opção de vir até a loja, só avaliação no endereço do lead"}

Dados atuais do lead: nome=${lead.name ?? "desconhecido"}, status=${lead.status}, score=${lead.score},
veículo=${lead.vehicleInfo ?? "desconhecido"}, valor pretendido=${lead.askingPrice ?? "desconhecido"},
urgência=${lead.urgency ?? "desconhecida"}. ${appointmentInfo}${extraInstruction ? `\n\n${extraInstruction}` : ""}`;

  const messages: Anthropic.MessageParam[] = lead.conversation.messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({
      role: m.sender === "LEAD" ? "user" : "assistant",
      content: m.content,
    }));
  if (messages.length === 0) return null;

  // Se a última mensagem já é do lead (role "user"), o pedido normal à API já gera uma
  // resposta nova. Quando a última foi nossa (ou queremos forçar um follow-up), precisamos
  // fechar a conversa com um turno "user" — senão a API só completaria a fala anterior.
  if (appendFollowUpNudge) {
    messages.push({ role: "user", content: buildFollowUpNudge(lead.conversation.followUpAttempts) });
  } else if (internalNote) {
    messages.push({ role: "user", content: internalNote });
  }

  let replyText = "";
  const updates: Record<string, unknown> = {};
  const reminders: { dueDate: string; note?: string }[] = [];
  const appointments: { scheduledAt: string; location: "LOJA" | "ENDERECO_CLIENTE"; address?: string; notes?: string }[] = [];
  let handoffReason: string | null = null;

  // Faz o round-trip de tool use corretamente: se o Claude só chamar ferramentas e não
  // escrever texto, devolvemos o resultado delas e pedimos a resposta de verdade.
  for (let turn = 0; turn < 3; turn++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 512,
      system: systemPrompt,
      tools: [updateLeadTool, scheduleReminderTool, scheduleAppointmentTool, handoffToHumanTool],
      messages,
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    for (const block of toolUseBlocks) {
      if (block.name === "update_lead") {
        Object.assign(updates, block.input as Record<string, unknown>);
      } else if (block.name === "schedule_reminder") {
        reminders.push(block.input as { dueDate: string; note?: string });
      } else if (block.name === "schedule_appointment") {
        appointments.push(
          block.input as { scheduledAt: string; location: "LOJA" | "ENDERECO_CLIENTE"; address?: string; notes?: string }
        );
      } else if (block.name === "handoff_to_human") {
        handoffReason = (block.input as { reason?: string }).reason ?? "pediu o endereço da loja";
      }
    }

    for (const block of response.content) {
      if (block.type === "text") replyText += block.text;
    }

    if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) break;

    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: toolUseBlocks.map((b) => ({
        type: "tool_result" as const,
        tool_use_id: b.id,
        content: "ok, registrado no CRM",
      })),
    });
  }

  if ("status" in updates) {
    const status = sanitizeAiStatus(lead.status, updates.status);
    if (status) updates.status = status;
    else delete updates.status;
  }
  if (updates.status !== "PERDIDO") delete updates.lossReason;
  // Cidade/UF digitadas pela equipe valem mais que o que a IA entendeu da conversa
  if (lead.city) delete updates.city;
  if (lead.state) delete updates.state;

  if (Object.keys(updates).length > 0) {
    const updatedLead = await prisma.lead.update({ where: { id: lead.id }, data: updates as any });
    getIO().emit("lead:updated", updatedLead);
  }

  for (const r of reminders) {
    const dueAt = parseBrazilDateTime(r.dueDate);
    if (Number.isNaN(dueAt.getTime())) continue;
    const reminder = await prisma.reminder.create({
      data: { leadId: lead.id, dueAt, note: r.note },
      include: {
        lead: {
          select: { id: true, name: true, phone: true, vehicleBrand: true, vehicleModel: true, vehicleYear: true, vehicleInfo: true },
        },
      },
    });
    getIO().emit("reminder:created", reminder);
  }

  for (const a of appointments) {
    const scheduledAt = parseBrazilDateTime(a.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) continue;
    const locationNote = a.location === "ENDERECO_CLIENTE" ? `Avaliação no endereço do lead: ${a.address ?? "(endereço não informado)"}` : "Visita na loja";
    const notes = [locationNote, a.notes].filter(Boolean).join(" — ");

    // A IA às vezes chama a ferramenta mais de uma vez pro mesmo combinado (ou de novo em outra
    // resposta): mesmo horário = o mesmo agendamento, não cria outro. Horário diferente = remarcação,
    // então os agendamentos futuros anteriores do lead são cancelados em vez de ficarem duplicados.
    const duplicate = await prisma.appointment.findFirst({
      where: { leadId: lead.id, scheduledAt, status: { not: "CANCELADO" } },
    });
    if (duplicate) continue;
    const superseded = await prisma.appointment.findMany({
      where: { leadId: lead.id, scheduledAt: { gte: new Date() }, status: { in: ["AGENDADO", "CONFIRMADO"] } },
    });
    for (const old of superseded) {
      const cancelled = await prisma.appointment.update({
        where: { id: old.id },
        data: { status: "CANCELADO" },
        include: {
          lead: {
            select: { id: true, name: true, phone: true, vehicleBrand: true, vehicleModel: true, vehicleYear: true, vehicleInfo: true },
          },
        },
      });
      getIO().emit("appointment:updated", cancelled);
    }

    const appointment = await prisma.appointment.create({
      data: { leadId: lead.id, scheduledAt, notes },
      include: {
        lead: {
          select: { id: true, name: true, phone: true, vehicleBrand: true, vehicleModel: true, vehicleYear: true, vehicleInfo: true },
        },
      },
    });
    getIO().emit("appointment:created", appointment);
  }

  // A IA pediu handoff (ex: lead perguntou o endereço da loja) — desliga o atendimento automático
  // dessa conversa, igual acontece quando um agente manda mensagem manual, pra um humano assumir
  // e confirmar o endereço direto (evita a IA chutar ou citar de memória um endereço errado).
  if (handoffReason && lead.conversation.aiEnabled) {
    const updatedConversation = await prisma.conversation.update({
      where: { id: lead.conversation.id },
      data: { aiEnabled: false },
    });
    getIO().emit("conversation:updated", {
      id: updatedConversation.id,
      leadId: lead.id,
      aiEnabled: updatedConversation.aiEnabled,
    });
  }

  if (!replyText.trim()) return null;

  const savedMessage = await prisma.message.create({
    data: { conversationId: lead.conversation.id, sender: "AI", content: replyText },
  });
  getIO().emit("message:new", { leadId: lead.id, message: savedMessage });
  await markContactedIfNew(lead.id);

  if (appendFollowUpNudge) {
    await prisma.conversation.update({
      where: { id: lead.conversation.id },
      data: { followUpAttempts: { increment: 1 } },
    });
  }

  return replyText;
}

const writeAdTool: Anthropic.Tool = {
  name: "write_ad",
  description: "Escreve o anúncio de venda do veículo.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Título curto e chamativo do anúncio, até 60 caracteres" },
      description: {
        type: "string",
        description:
          "Descrição de venda em 3-6 linhas, destacando estado de conservação, diferenciais e itens de série. Sem emojis exagerados, tom profissional e atrativo.",
      },
    },
    required: ["title", "description"],
  },
};

export interface AdCopy {
  title: string;
  description: string;
}

export async function generateAdCopy(leadId: string): Promise<AdCopy> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error("Lead não encontrado");

  const vehicleParts = [lead.vehicleBrand, lead.vehicleModel, lead.vehicleYear].filter(Boolean).join(" ");
  const prompt = `Dados do veículo para o anúncio de venda:
- Veículo: ${vehicleParts || lead.vehicleInfo || "não informado"}
- Quilometragem: ${lead.vehicleKm ? `${lead.vehicleKm.toLocaleString("pt-BR")} km` : "não informada"}
- Valor de referência FIPE: ${lead.fipeValue || "não informado"}
- Valor de venda: ${lead.salePrice ? lead.salePrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : lead.askingPrice || "a definir"}
- Observações/estado: ${lead.notes || lead.vehicleInfo || "nenhuma observação adicional"}

Escreva um anúncio de venda para este veículo usando a ferramenta write_ad.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 512,
    system:
      "Você é um redator de anúncios de veículos usados para uma loja que revende carros. " +
      "Seja honesto (não invente características não informadas), persuasivo e direto, em português.",
    tools: [writeAdTool],
    tool_choice: { type: "tool", name: "write_ad" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "write_ad"
  );
  if (!toolUse) throw new Error("A IA não retornou o anúncio");

  return toolUse.input as AdCopy;
}

// Leads @lid cujo número real o WhatsApp não revela ficam sem DDD no funil. Muitos dizem onde
// moram na conversa ("sou de Colombo", "tô no Boqueirão"), então um modelo barato lê só as
// mensagens do lead e devolve cidade/UF/DDD. Cada lead é analisado uma vez: sem cidade, fica
// areaCode "" (a IA de atendimento ainda preenche depois, via update_lead, se ele citar).
const AREA_CODE_MODEL = "claude-haiku-4-5";
const AREA_CODE_INTERVAL_MS = 30 * 60 * 1000;
const AREA_CODE_MAX_CHARS = 6000;

const reportLocationTool: Anthropic.Tool = {
  name: "report_location",
  description: "Informa onde o lead mora ou onde está o veículo, conforme as mensagens dele.",
  input_schema: {
    type: "object",
    properties: {
      city: { type: "string", description: "Cidade (ou bairro de Curitiba → 'Curitiba'). Vazio se ele não disse." },
      state: { type: "string", description: "UF com 2 letras, ex: 'PR'. Vazio se não dá pra saber." },
      areaCode: { type: "string", description: "DDD da cidade, 2 dígitos, ex: '41'. Vazio se não dá pra saber." },
    },
    required: ["city", "state", "areaCode"],
  },
};

let areaCodeRunning = false;

async function inferLeadAreaCodes() {
  if (areaCodeRunning) return;
  areaCodeRunning = true;
  let found = 0;
  let checked = 0;
  try {
    const leads = await prisma.lead.findMany({
      where: {
        areaCode: null,
        phone: { endsWith: "@lid" },
        OR: [{ phone2: null }, { phone2: "" }],
        conversation: { messages: { some: { sender: "LEAD" } } },
      },
      select: {
        id: true,
        city: true,
        state: true,
        conversation: {
          select: { messages: { where: { sender: "LEAD" }, orderBy: { createdAt: "asc" }, select: { content: true } } },
        },
      },
    });
    for (const lead of leads) {
      const text = (lead.conversation?.messages ?? [])
        .map((m) => m.content.trim())
        .filter(Boolean)
        .join("\n")
        .slice(0, AREA_CODE_MAX_CHARS);
      let city = "";
      let state = "";
      let areaCode = "";
      if (text) {
        const response = await anthropic.messages.create({
          model: AREA_CODE_MODEL,
          max_tokens: 256,
          system:
            "Você lê mensagens de WhatsApp de pessoas querendo vender o carro para uma loja de Curitiba/PR. " +
            "Descubra só pelo que a pessoa escreveu onde ela mora ou onde está o veículo. Não chute: se ela " +
            "não citou cidade, bairro ou região, devolva tudo vazio. Bairros de Curitiba contam como Curitiba.",
          tools: [reportLocationTool],
          tool_choice: { type: "tool", name: "report_location" },
          messages: [{ role: "user", content: `Mensagens do lead:\n${text}` }],
        });
        const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        const input = (block?.input ?? {}) as { city?: string; state?: string; areaCode?: string };
        city = input.city?.trim() ?? "";
        state = input.state?.trim().toUpperCase().slice(0, 2) ?? "";
        areaCode = /^\d{2}$/.test(input.areaCode?.trim() ?? "") ? input.areaCode!.trim() : "";
      }
      const updated = await prisma.lead.update({
        where: { id: lead.id },
        data: {
          areaCode,
          ...(city && !lead.city ? { city } : {}),
          ...(state && !lead.state ? { state } : {}),
        },
      });
      getIO().emit("lead:updated", updated);
      checked++;
      if (areaCode) found++;
    }
  } finally {
    areaCodeRunning = false;
    if (checked) console.log(`IA: DDD pela conversa — ${found} de ${checked} lead(s) analisado(s) disseram a cidade`);
  }
}

export function startAreaCodeInference() {
  const run = () =>
    inferLeadAreaCodes().catch((err) => console.error("Erro ao descobrir o DDD dos leads pela conversa:", err));
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, AREA_CODE_INTERVAL_MS);
}

// Resumo curto da conversa pra equipe se situar sem reler tudo: o que o lead quer, o que já foi
// combinado e qual o próximo passo. Gerado sob demanda (não é guardado no banco).
export async function summarizeConversation(leadId: string): Promise<string> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { conversation: { include: { messages: { orderBy: { createdAt: "desc" }, take: 80 } } } },
  });
  if (!lead?.conversation || lead.conversation.messages.length === 0) {
    throw new Error("Esse lead ainda não tem conversa");
  }

  const transcript = [...lead.conversation.messages]
    .reverse()
    .map((m) => `${m.sender === "LEAD" ? "Lead" : m.sender === "AI" ? "IA" : "Equipe"}: ${m.content}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 400,
    system:
      "Você resume conversas de WhatsApp de uma loja que compra veículos de pessoas que precisam vender. " +
      "Responda em português, em no máximo 5 tópicos curtos iniciados por '•': o que o lead quer, veículo e valor " +
      "pedido, urgência/objeções, o que já foi combinado ou enviado e o PRÓXIMO PASSO sugerido para a equipe. " +
      "Use só o que está na conversa; não invente nada.",
    messages: [
      {
        role: "user",
        content: `Lead: ${lead.name ?? "sem nome"} (status ${lead.status})\n\nConversa (mais antigas primeiro):\n${transcript}`,
      },
    ],
  });

  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!block?.text.trim()) throw new Error("A IA não retornou o resumo");
  return block.text.trim();
}
