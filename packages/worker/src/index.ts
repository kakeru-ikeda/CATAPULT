import { PrismaClient } from "@prisma/client";
import cron from "node-cron";

import { createWorker, prisma as jobPrisma, redis as jobRedis } from "./job-processor.js";
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

// Worker が DB 準備完了前にジョブを拾わないよう DB 確認後に生成する
await waitForDatabase();
const worker = createWorker();

worker.on("completed", (job) => {
  console.info(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

// 毎時 0 分に期限切れ間近のトークンを先回りリフレッシュ
const cronTask = cron.schedule("0 * * * *", () => {
  batchRefreshExpiringTokens().catch((err: unknown) => {
    console.error("Batch token refresh failed:", err);
  });
});

console.info("Worker started");

async function shutdown(signal: string): Promise<void> {
  console.info(`Received ${signal}, shutting down...`);
  await cronTask.stop();
  await worker.close();
  await Promise.all([jobRedis.quit(), jobPrisma.$disconnect()]);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
