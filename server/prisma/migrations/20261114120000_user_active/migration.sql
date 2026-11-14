-- Acesso ao CRM: false = a pessoa não consegue mais entrar (os leads e o histórico dela ficam).
ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
