-- AlterEnum
ALTER TYPE "ConversationStatus" ADD VALUE 'in_progress';

-- AlterTable
ALTER TABLE "KnowledgeItem" ADD COLUMN     "category" TEXT,
ADD COLUMN     "mailboxId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE "TenantSetting" ADD COLUMN     "aiModelUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ConversationDraft" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "baseRevision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeItemVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeItemVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationDraft_tenantId_userId_idx" ON "ConversationDraft"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationDraft_conversationId_userId_mode_key" ON "ConversationDraft"("conversationId", "userId", "mode");

-- CreateIndex
CREATE INDEX "Notification_tenantId_userId_readAt_createdAt_idx" ON "Notification"("tenantId", "userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_tenantId_conversationId_idx" ON "Notification"("tenantId", "conversationId");

-- CreateIndex
CREATE INDEX "KnowledgeItemVersion_tenantId_idx" ON "KnowledgeItemVersion"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeItemVersion_itemId_version_key" ON "KnowledgeItemVersion"("itemId", "version");

-- AddForeignKey
ALTER TABLE "ConversationDraft" ADD CONSTRAINT "ConversationDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItemVersion" ADD CONSTRAINT "KnowledgeItemVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "KnowledgeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
