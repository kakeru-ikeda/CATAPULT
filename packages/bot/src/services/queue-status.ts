import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";

const prisma = new PrismaClient();
const bullQueue = new Queue("jobs", { connection: { url: process.env["REDIS_URL"]! } });

export interface QueueStatus {
  position: number;
  estimatedWaitMinutes: number;
}

export async function getQueuePosition(jobId: string): Promise<QueueStatus> {
  const waitingJobs = await bullQueue.getWaiting();
  const position = waitingJobs.findIndex((j) => j.id === jobId) + 1;

  const recentJobs = await prisma.job.findMany({
    where: { status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    take: 10,
    select: { startedAt: true, completedAt: true },
  });

  const totalMs = recentJobs.reduce(
    (sum: number, j: { startedAt: Date | null; completedAt: Date | null }) => {
      if (!j.startedAt || !j.completedAt) return sum;
      return sum + (j.completedAt.getTime() - j.startedAt.getTime());
    },
    0,
  );

  const avgDurationMs = recentJobs.length > 0 ? totalMs / recentJobs.length : 5 * 60 * 1000;
  const estimatedWaitMs = position * avgDurationMs;

  return {
    position,
    estimatedWaitMinutes: Math.ceil(estimatedWaitMs / 60_000),
  };
}
