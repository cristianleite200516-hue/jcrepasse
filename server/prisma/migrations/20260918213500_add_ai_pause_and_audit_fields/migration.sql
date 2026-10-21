-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "auditAlertedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "aiPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "auditPhone" TEXT;
