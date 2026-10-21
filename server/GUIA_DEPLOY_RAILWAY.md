# Guia de deploy do CRM vmca no Railway

Este guia tira o backend do Mac + ngrok e coloca rodando 24/7 no Railway.

---

## 1. Copiar os arquivos preparados

Baixe os dois arquivos que preparei (`Dockerfile` e `railway.json`) e copie
para dentro da pasta `server`:

```bash
cp ~/Downloads/Dockerfile ~/Desktop/claudefp/server/Dockerfile
cp ~/Downloads/railway.json ~/Desktop/claudefp/server/railway.json
```

## 2. Trocar SQLite por Postgres no Prisma

Abra `~/Desktop/claudefp/server/prisma/schema.prisma` e troque:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

por:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

## 3. Subir o código para o GitHub

Se a pasta `claudefp` ainda não é um repositório remoto:

```bash
cd ~/Desktop/claudefp
git init
git add .
git commit -m "Preparar deploy no Railway"
```

Crie um repositório privado em github.com/new (sem README, sem .gitignore —
você já tem um), depois:

```bash
git remote add origin https://github.com/SEU_USUARIO/claudefp.git
git branch -M main
git push -u origin main
```

## 4. Criar o projeto no Railway

1. Acesse [railway.app](https://railway.app) e faça login com GitHub
2. Clique em **New Project** → **Deploy from GitHub repo**
3. Selecione o repositório `claudefp`
4. Em **Settings** do serviço criado, defina **Root Directory** como `/server`
   (porque o backend fica dentro dessa subpasta)

## 5. Adicionar o banco Postgres

1. No mesmo projeto, clique em **+ New** → **Database** → **Add PostgreSQL**
2. O Railway cria a variável `DATABASE_URL` automaticamente nesse serviço de banco

## 6. Configurar as variáveis de ambiente do backend

Na aba **Variables** do serviço do backend (não do banco), adicione:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Clique em "Add Reference" → selecione a `DATABASE_URL` do Postgres |
| `JWT_SECRET` | Gere um novo valor aleatório longo (ex: `openssl rand -base64 32`) |
| `ANTHROPIC_API_KEY` | Sua chave atual (a mesma do `.env` local) |
| `APIFIPE_TOKEN` | Seu token atual |
| `CLIENT_ORIGIN` | URL do seu frontend em produção (não `localhost`) |

Não precisa adicionar `PORT` — o Railway define isso automaticamente.

## 7. Configurar o volume para a sessão do WhatsApp

1. No serviço do backend, vá em **Settings** → **Volumes** → **New Volume**
2. Monte no caminho: `/app/.wwebjs_auth`
3. Isso garante que a sessão logada do WhatsApp sobrevive a reinícios e redeploys

## 8. Deploy

O Railway já vai detectar o `railway.json` e usar o `Dockerfile` automaticamente
a cada push. Acompanhe os logs em **Deployments** — na primeira execução,
o QR Code do WhatsApp vai aparecer nos logs em texto (formato ASCII). Escaneie
com o WhatsApp do número da loja para autenticar.

## 9. Depois que estiver no ar

- Anote a URL pública que o Railway gera (em **Settings** → **Networking** →
  **Generate Domain**)
- Se algum outro serviço (ex: frontend, Meta Ads webhook) apontava para a URL
  do ngrok, atualize para essa nova URL fixa
- Pode desligar o processo do ngrok no Mac — não é mais necessário

---

## Custo esperado

- Backend (Hobby plan): ~$5/mês
- Postgres: consome parte dos créditos incluídos no Hobby; para um CRM pequeno,
  deve ficar dentro do limite ou pouco acima

## Se algo der errado

- **Erro "Failed to launch the browser process"**: confirme que o `Dockerfile`
  foi mesmo usado (verifique em Settings → Build se o builder está como
  "Dockerfile" e não "Nixpacks")
- **QR Code não aparece nos logs**: verifique se o volume foi montado no
  caminho certo e se as variáveis de ambiente estão todas presentes
- **Erro de conexão com banco**: confirme que a referência de `DATABASE_URL`
  aponta para o serviço Postgres certo (não digite a URL manualmente)
