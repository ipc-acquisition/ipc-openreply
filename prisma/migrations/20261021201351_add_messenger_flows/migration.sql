-- CreateEnum
CREATE TYPE "FlowEnrollmentStatus" AS ENUM ('ACTIVE', 'PAUSED_WINDOW', 'PAUSED_TAKEOVER', 'COMPLETED', 'STOPPED_OPTOUT', 'STOPPED_MANUAL');

-- CreateEnum
CREATE TYPE "FlowSendStatus" AS ENUM ('CLAIMED', 'SENT', 'FAILED', 'SKIPPED_WINDOW', 'SKIPPED_TAKEOVER', 'SKIPPED_OPTOUT');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "flowId" TEXT;

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "psid" TEXT NOT NULL,
    "name" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "humanTakeoverUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "triggerAnyMessage" BOOLEAN NOT NULL DEFAULT true,
    "triggerKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wholeWordMatch" BOOLEAN NOT NULL DEFAULT false,
    "stopKeywords" TEXT[] DEFAULT ARRAY['parar', 'sair', 'stop', 'cancelar']::TEXT[],
    "resumeOnReply" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowStep" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowButton" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowButton_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowEnrollment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "automationId" TEXT,
    "status" "FlowEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextStepPosition" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3),
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowSendLog" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" "FlowSendStatus" NOT NULL,
    "mid" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),

    CONSTRAINT "FlowSendLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowClick" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "buttonId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "recipientHash" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_workspaceId_idx" ON "Contact"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_instagramAccountId_psid_key" ON "Contact"("instagramAccountId", "psid");

-- CreateIndex
CREATE INDEX "Flow_workspaceId_idx" ON "Flow"("workspaceId");

-- CreateIndex
CREATE INDEX "Flow_instagramAccountId_idx" ON "Flow"("instagramAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowStep_flowId_position_key" ON "FlowStep"("flowId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "FlowButton_slug_key" ON "FlowButton"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "FlowButton_stepId_position_key" ON "FlowButton"("stepId", "position");

-- CreateIndex
CREATE INDEX "FlowEnrollment_workspaceId_idx" ON "FlowEnrollment"("workspaceId");

-- CreateIndex
CREATE INDEX "FlowEnrollment_contactId_idx" ON "FlowEnrollment"("contactId");

-- CreateIndex
CREATE INDEX "FlowEnrollment_status_idx" ON "FlowEnrollment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FlowEnrollment_flowId_contactId_key" ON "FlowEnrollment"("flowId", "contactId");

-- CreateIndex
CREATE INDEX "FlowSendLog_stepId_status_idx" ON "FlowSendLog"("stepId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FlowSendLog_enrollmentId_stepId_key" ON "FlowSendLog"("enrollmentId", "stepId");

-- CreateIndex
CREATE INDEX "FlowClick_buttonId_idx" ON "FlowClick"("buttonId");

-- CreateIndex
CREATE INDEX "FlowClick_workspaceId_createdAt_idx" ON "FlowClick"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowStep" ADD CONSTRAINT "FlowStep_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowButton" ADD CONSTRAINT "FlowButton_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "FlowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowEnrollment" ADD CONSTRAINT "FlowEnrollment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowEnrollment" ADD CONSTRAINT "FlowEnrollment_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowEnrollment" ADD CONSTRAINT "FlowEnrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowEnrollment" ADD CONSTRAINT "FlowEnrollment_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowSendLog" ADD CONSTRAINT "FlowSendLog_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "FlowEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowSendLog" ADD CONSTRAINT "FlowSendLog_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "FlowStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowClick" ADD CONSTRAINT "FlowClick_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowClick" ADD CONSTRAINT "FlowClick_buttonId_fkey" FOREIGN KEY ("buttonId") REFERENCES "FlowButton"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowClick" ADD CONSTRAINT "FlowClick_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "FlowEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
