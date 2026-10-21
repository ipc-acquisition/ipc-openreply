-- CreateEnum
CREATE TYPE "ModerationAction" AS ENUM ('HIDE', 'DELETE');

-- CreateEnum
CREATE TYPE "ModerationActionStatus" AS ENUM ('PENDING', 'DONE', 'FAILED', 'UNDONE');

-- CreateTable
CREATE TABLE "ModerationRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wholeWordMatch" BOOLEAN NOT NULL DEFAULT false,
    "action" "ModerationAction" NOT NULL DEFAULT 'HIDE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "ruleId" TEXT,
    "commentId" TEXT NOT NULL,
    "mediaId" TEXT,
    "commenterId" TEXT NOT NULL,
    "commenterName" TEXT,
    "commentText" TEXT NOT NULL,
    "matchedKeyword" TEXT,
    "action" "ModerationAction" NOT NULL,
    "actionStatus" "ModerationActionStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModerationRule_workspaceId_idx" ON "ModerationRule"("workspaceId");

-- CreateIndex
CREATE INDEX "ModerationRule_instagramAccountId_idx" ON "ModerationRule"("instagramAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationLog_commentId_key" ON "ModerationLog"("commentId");

-- CreateIndex
CREATE INDEX "ModerationLog_instagramAccountId_createdAt_idx" ON "ModerationLog"("instagramAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationLog_workspaceId_idx" ON "ModerationLog"("workspaceId");

-- AddForeignKey
ALTER TABLE "ModerationRule" ADD CONSTRAINT "ModerationRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationRule" ADD CONSTRAINT "ModerationRule_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationLog" ADD CONSTRAINT "ModerationLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationLog" ADD CONSTRAINT "ModerationLog_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationLog" ADD CONSTRAINT "ModerationLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ModerationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
