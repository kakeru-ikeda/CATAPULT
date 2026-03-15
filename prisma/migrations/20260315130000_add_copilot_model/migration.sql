-- AlterTable: Job に model フィールドを追加
ALTER TABLE "Job" ADD COLUMN "model" TEXT;

-- CreateTable: CopilotModel
CREATE TABLE "CopilotModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopilotModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CopilotModel_name_key" ON "CopilotModel"("name");
