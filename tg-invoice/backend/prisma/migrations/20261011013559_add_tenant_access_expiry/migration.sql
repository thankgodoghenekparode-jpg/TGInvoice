-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "accessExpiresAt" TIMESTAMP(3),
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "accessExpiresAt" TIMESTAMP(3),
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Membership_accessExpiresAt_idx" ON "Membership"("accessExpiresAt");

-- CreateIndex
CREATE INDEX "Membership_suspendedAt_idx" ON "Membership"("suspendedAt");
