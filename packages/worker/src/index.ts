import { PrismaClient } from "@prisma/client";
import cron from "node-cron";

import { worker } from "./job-processor.js";
import { batchRefreshExpiringTokens } from "./token-refresher.js";

async function waitForDatabase(maxRetries = 10, delayMs = 3000): Promise<void> {
  const prisma = new PrismaClient();
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await prisma.$disconnect();
      console.info("Database connection established");
      return;
    } catch {
      console.warn(`Database not ready, retrying... (${i}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  await prisma.$disconnect();
  throw new Error("Failed to connect to database after retries");
}

// Worker が DB 準備完了前にジョブを拾わないよう一時停止
await worker.pause();
await waitForDatabase();
worker.resume();

worker.on("completed", (job) => {
  console.info(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

// 毎時 0 分に期限切れ間近のトークンを先回りリフレッシュ
cron.schedule("0 * * * *", () => {
  batchRefreshExpiringTokens().catch((err: unknown) => {
    console.error("Batch token refresh failed:", err);
  });
});

console.info("Worker started");
