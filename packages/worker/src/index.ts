import cron from "node-cron";

import { worker } from "./job-processor.js";
import { batchRefreshExpiringTokens } from "./token-refresher.js";

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
