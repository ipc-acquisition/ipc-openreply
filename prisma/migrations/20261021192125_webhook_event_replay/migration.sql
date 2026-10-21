-- Lets the worker replay webhook payloads that were persisted but never reached
-- Redis. Additive only: a new status value and a nullable column.

-- AlterEnum
ALTER TYPE "WebhookStatus" ADD VALUE 'NOT_ENQUEUED';

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "provider" "InstagramProvider";
