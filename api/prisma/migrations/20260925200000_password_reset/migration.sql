ALTER TABLE "User"
  ADD COLUMN "passwordResetTokenHash" TEXT,
  ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3),
  ADD COLUMN "passwordResetRequestedAt" TIMESTAMP(3);
ALTER TABLE "PlatformAdmin"
  ADD COLUMN "passwordResetTokenHash" TEXT,
  ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3),
  ADD COLUMN "passwordResetRequestedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_passwordResetTokenHash_key" ON "User"("passwordResetTokenHash");
CREATE UNIQUE INDEX "PlatformAdmin_passwordResetTokenHash_key" ON "PlatformAdmin"("passwordResetTokenHash");
