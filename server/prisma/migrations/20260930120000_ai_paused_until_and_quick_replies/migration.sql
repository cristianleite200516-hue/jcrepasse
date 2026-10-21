-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "aiPausedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "quickReplies" TEXT;
