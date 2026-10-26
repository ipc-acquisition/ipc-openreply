-- CreateEnum
CREATE TYPE "FacebookTokenKind" AS ENUM ('SYSTEM_USER', 'USER');

-- AlterTable
ALTER TABLE "FacebookPageConnection" ADD COLUMN     "dataAccessExpiresAt" TIMESTAMP(3),
ADD COLUMN     "ownerName" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "tokenKind" "FacebookTokenKind" NOT NULL DEFAULT 'SYSTEM_USER';
