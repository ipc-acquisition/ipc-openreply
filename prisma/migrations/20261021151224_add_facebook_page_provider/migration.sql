-- AlterEnum
ALTER TYPE "InstagramProvider" ADD VALUE 'FACEBOOK_PAGE';

-- AlterTable
ALTER TABLE "DmLog" ADD COLUMN     "recipientId" TEXT;

-- CreateTable
CREATE TABLE "FacebookPageConnection" (
    "workspaceId" TEXT NOT NULL,
    "systemUserToken" TEXT NOT NULL,
    "systemUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacebookPageConnection_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE INDEX "DmLog_automationId_recipientId_idx" ON "DmLog"("automationId", "recipientId");

-- AddForeignKey
ALTER TABLE "FacebookPageConnection" ADD CONSTRAINT "FacebookPageConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
