-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "ExecutionMode" AS ENUM ('SERVER', 'LOCAL');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "executionMode" "ExecutionMode" NOT NULL DEFAULT 'SERVER',
ADD COLUMN     "localAgentId" TEXT;

-- CreateTable
CREATE TABLE "LocalAgent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workspaceRoot" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'OFFLINE',
    "lastHeartbeatAt" TIMESTAMP(3),
    "agentToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalAgent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocalAgent_agentToken_key" ON "LocalAgent"("agentToken");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_localAgentId_fkey" FOREIGN KEY ("localAgentId") REFERENCES "LocalAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalAgent" ADD CONSTRAINT "LocalAgent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
