-- CreateTable
CREATE TABLE "ThreadCanvas" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "channelId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreadCanvas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ThreadCanvas_canvasId_key" ON "ThreadCanvas"("canvasId");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadCanvas_platform_channelId_threadId_key" ON "ThreadCanvas"("platform", "channelId", "threadId");
