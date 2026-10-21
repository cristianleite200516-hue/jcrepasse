-- Segurança dos disparos em massa: lead que pediu pra sair (SAIR) não recebe mais campanhas, e o
-- contador diário de envios em lote (limite por dia) fica nas configurações.
ALTER TABLE "Lead" ADD COLUMN "doNotContact" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "broadcastSentDay" TEXT;
ALTER TABLE "Settings" ADD COLUMN "broadcastSentCount" INTEGER NOT NULL DEFAULT 0;
