-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "autoSendChannels" "MessageChannel"[] DEFAULT ARRAY[]::"MessageChannel"[];
