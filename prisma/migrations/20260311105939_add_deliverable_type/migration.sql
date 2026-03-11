-- CreateEnum
CREATE TYPE "DeliverableType" AS ENUM ('PR', 'REPORT', 'COMMIT_ONLY', 'REVIEW');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "deliverableType" "DeliverableType" NOT NULL DEFAULT 'PR';
