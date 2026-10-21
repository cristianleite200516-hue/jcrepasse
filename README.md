# CRM — Compra de Veículos com Atendimento IA (WhatsApp)

CRM para organizar leads de uma loja que compra veículos de pessoas que precisam vender com urgência.
Mensagens recebidas no WhatsApp criam/atualizam leads automaticamente, uma IA (Claude) conduz a
qualificação inicial e responde ao lead, e a equipe consegue acompanhar tudo em tempo real e assumir
a conversa manualmente quando quiser.

## Estrutura

- `server/` — API (Node.js + Express + TypeScript), banco SQLite via Prisma, Socket.IO, integração
  com WhatsApp (`whatsapp-web.js`) e com a IA (Claude, via `@anthropic-ai/sdk`).
- `client/` — Dashboard web (React + Vite + TypeScript + TailwindCSS).

## Configuração inicial

### 1. Backend

```bash
cd server
cp .env.example .env
```

Edite `server/.env` e preencha `ANTHROPIC_API_KEY` com sua chave da Anthropic
(https://console.anthropic.com). O `JWT_SECRET` já foi gerado.

```bash
npm install
npx prisma migrate dev
npm run seed:admin
npm run dev
```

Isso cria o usuário administrador padrão:
- **E-mail:** `admin@crm.local`
- **Senha:** `admin123`

(Altere a senha depois de logar, ou defina `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` no `.env`
antes de rodar o seed pela primeira vez.)

A API sobe em `http://localhost:3001`.

### 2. Frontend

Em outro terminal:

```bash
cd client
npm install
npm run dev
```

O dashboard sobe em `http://localhost:5173`.

### 3. Conectar o WhatsApp

1. Logue no dashboard e vá em **WhatsApp**.
2. Clique em **Conectar WhatsApp** — um QR code vai aparecer.
3. No celular que vai atender os leads, abra o WhatsApp → **Aparelhos conectados** → **Conectar um
   aparelho** → escaneie o QR code.
4. Pronto — mensagens recebidas nesse número passam a criar leads automaticamente e a IA já pode
   responder.

⚠️ **Importante:** a conexão usa `whatsapp-web.js`, uma biblioteca não-oficial que automatiza o
WhatsApp Web. Ela não tem custo nem exige aprovação de negócio, mas tecnicamente viola os Termos de
Uso do WhatsApp e o número pode, em tese, ser banido. Recomenda-se usar um número secundário/de teste,
não o pessoal principal. Para uso em produção mais sério, considere migrar para a API oficial da Meta
(WhatsApp Business Platform) ou um provedor como Twilio — a integração fica isolada em
`server/src/whatsapp/client.ts` para facilitar essa troca depois.

## Funcionalidades

- Login com JWT, usuários com papel **admin** ou **agente** (crie novos usuários via
  `POST /api/auth/users`, autenticado como admin).
- Kanban de leads (Novo → Contatado → Qualificado → Proposta → Ganho/Perdido).
- Atendimento automático por IA no WhatsApp: qualifica o lead (dados do veículo, valor pretendido,
  urgência) e atualiza o CRM sozinha.
- Tela de conversa por lead em tempo real, com botão para ligar/desligar a IA e responder manualmente.
- Configurações: editar o prompt da IA e as informações do negócio usadas nas respostas.

## Próximos passos sugeridos (fora do escopo inicial)

- Drag-and-drop no Kanban.
- Canal de e-mail além do WhatsApp.
- Relatórios/analytics do funil.
- Permissões mais granulares além de admin/agente.
- Deploy em nuvem (hoje roda local).
