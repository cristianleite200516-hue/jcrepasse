-- Bloqueios por pessoa: false = a pessoa não vê nem usa a página (Configurações / WhatsApp).
ALTER TABLE "User" ADD COLUMN "canSettings" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "canWhatsapp" BOOLEAN NOT NULL DEFAULT true;
