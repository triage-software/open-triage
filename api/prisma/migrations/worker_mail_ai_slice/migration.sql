-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "aiCategory" TEXT,
ADD COLUMN     "aiDraftAt" TIMESTAMP(3),
ADD COLUMN     "aiDraftModel" TEXT,
ADD COLUMN     "aiDraftSourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "aiDraftText" TEXT,
ADD COLUMN     "aiPriority" TEXT,
ADD COLUMN     "aiReason" TEXT;

-- AlterTable
ALTER TABLE "Mailbox" ADD COLUMN     "imapLastUid" INTEGER,
ADD COLUMN     "imapUidValidity" TEXT,
ADD COLUMN     "smtpHost" TEXT,
ADD COLUMN     "smtpPort" INTEGER,
ADD COLUMN     "smtpSecure" BOOLEAN;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deliveryKey" TEXT,
ADD COLUMN     "sentCopyFolder" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_deliveryKey_key" ON "Message"("deliveryKey");

