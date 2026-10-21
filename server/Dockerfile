# Dockerfile para o backend do CRM vmca (server/)
# Coloque este arquivo em: ~/Desktop/claudefp/server/Dockerfile

FROM node:22-slim

# Dependências de sistema exigidas pelo Chromium (usado pelo puppeteer/whatsapp-web.js)
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# ffmpeg numa camada separada DE PROPÓSITO: converte os áudios gravados no painel pra OGG/Opus (voz do
# WhatsApp). Quando ele entrou na mesma linha do chromium, a camada acima foi refeita do zero e
# instalou um Chromium mais novo — e o WhatsApp parou de terminar de conectar (travava em 99%).
# Mantendo a linha do chromium idêntica, o build reaproveita a camada antiga em cache.
RUN apt-get update && apt-get install -y ffmpeg --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Diz ao Puppeteer para usar o Chromium do sistema em vez de baixar o seu próprio
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Horário de Brasília pro processo inteiro: sem isso o Node roda em UTC e tudo que calcula "hoje"
# (painel do dia, dashboard, a IA) vira o dia seguinte a partir das 21h. Fica DEPOIS das camadas
# de apt-get pra não invalidar o cache do Chromium.
ENV TZ=America/Sao_Paulo

WORKDIR /app

# Copia apenas os manifests primeiro (melhora cache de build). A pasta patches/ precisa vir
# ANTES do npm install porque o postinstall roda "patch-package" nesse momento — se ela só
# chegasse depois (junto do COPY . .), os patches ficariam no repo mas nunca seriam aplicados
# de verdade na imagem (foi o que aconteceu: o patch do whatsapp-web.js não pegava).
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY patches ./patches

RUN npm install

# Copia o restante do código
COPY . .

# Gera o client do Prisma e builda o TypeScript
RUN npx prisma generate
RUN npm run build

# Roda as migrações e sobe o servidor
CMD npx prisma migrate deploy && npm start
