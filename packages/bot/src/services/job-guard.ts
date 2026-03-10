import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();
const redis = new Redis(process.env["REDIS_URL"]!);

const JOB_GUARD_CONFIG = {
  maxConcurrentPerUser: 3,
  maxConcurrentPerRepo: 2,
  maxDailyPerUser: 50,
  cooldownMs: 10_000,
};

export class JobLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobLimitError";
  }
}

export class JobGuard {
  async check(userId: string, repository: string): Promise<void> {
    const runningByUser = await prisma.job.count({
      where: { userId, status: { in: ["PENDING", "RUNNING"] } },
    });
    if (runningByUser >= JOB_GUARD_CONFIG.maxConcurrentPerUser) {
      throw new JobLimitError(
        `同時実行できるジョブは最大 ${JOB_GUARD_CONFIG.maxConcurrentPerUser} 件です。`,
      );
    }

    const runningByRepo = await prisma.job.count({
      where: { repository, status: { in: ["PENDING", "RUNNING"] } },
    });
    if (runningByRepo >= JOB_GUARD_CONFIG.maxConcurrentPerRepo) {
      throw new JobLimitError(
        `このリポジトリでは同時に最大 ${JOB_GUARD_CONFIG.maxConcurrentPerRepo} 件まで実行できます。`,
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyCount = await prisma.job.count({
      where: { userId, createdAt: { gte: today } },
    });
    if (dailyCount >= JOB_GUARD_CONFIG.maxDailyPerUser) {
      throw new JobLimitError(
        `1日あたりのジョブ上限 (${JOB_GUARD_CONFIG.maxDailyPerUser}) に達しました。`,
      );
    }

    const lastJobKey = `job:last:${userId}`;
    const lastJobTime = await redis.get(lastJobKey);
    if (lastJobTime && Date.now() - parseInt(lastJobTime) < JOB_GUARD_CONFIG.cooldownMs) {
      const remaining = Math.ceil(
        (JOB_GUARD_CONFIG.cooldownMs - (Date.now() - parseInt(lastJobTime))) / 1000,
      );
      throw new JobLimitError(`次のジョブは ${remaining} 秒後に投入できます。`);
    }

    await redis.set(lastJobKey, Date.now().toString(), "EX", 60);
  }
}
