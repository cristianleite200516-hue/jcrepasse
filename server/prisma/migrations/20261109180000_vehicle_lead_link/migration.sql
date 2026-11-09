-- Histórico de Veículos ligado aos leads comprados + tipo de gasto.
-- Sem carga retroativa: os leads já comprados são os mesmos carros que vieram da planilha
-- (sem placa no lead), então criar carros a partir deles duplicaria o Histórico.
-- Daqui pra frente, cada compra nova entra sozinha (ver src/lib/vehicleSync.ts).
ALTER TABLE "Vehicle" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Vehicle" ADD COLUMN "leadId" TEXT;
CREATE UNIQUE INDEX "Vehicle_leadId_key" ON "Vehicle"("leadId");
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VehicleExpense" ADD COLUMN "category" TEXT;

UPDATE "Vehicle" SET "source" = 'planilha' WHERE "id" LIKE 'planilha\_%';
UPDATE "VehicleExpense" SET "category" = 'Outros' WHERE "description" = 'Custo (planilha)';
