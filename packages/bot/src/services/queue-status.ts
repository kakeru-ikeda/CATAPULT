import { Queue } from "bullmq";

const bullQueue = new Queue("jobs", { connection: { url: process.env["REDIS_URL"]! } });

export interface QueueStatus {
  position: number;
}

export async function getQueuePosition(jobId: string): Promise<QueueStatus> {
  const waitingJobs = await bullQueue.getWaiting();
  const position = waitingJobs.findIndex((j) => j.id === jobId) + 1;

  return { position };
}
