-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "confirmationSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "dailySummarySentOn" TEXT,
ADD COLUMN     "weeklyFollowUpRunOn" TEXT;
