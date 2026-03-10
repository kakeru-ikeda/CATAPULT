import { PrismaClient } from "@prisma/client";
import { Worker, type Job } from "bullmq";
import Redis from "ioredis";

import { CopilotExecutor, type CopilotEvent } from "./executor.js";
import { extractPrUrl } from "./output-parser.js";
import { cleanupWorkDir } from "./sandbox.js";
import { refreshTokenIfNeeded } from "./token-refresher.js";

const prisma = new PrismaClient();
// Redis pub/sub 配信用（ioredis インスタンス）
const redis = new Redis(process.env["REDIS_URL"]!);
// BullMQ は独自バンドルの ioredis を使うため URL オプションで接続
const bullmqConnection = { url: process.env["REDIS_URL"]! };

interface JobData {
  jobId: string;
}

async function getMcpConfig(userId: string): Promise<object | undefined> {
  const tools = await prisma.mcpTool.findMany({
    where: {
      enabled: true,
      OR: [{ isGlobal: true }, { ownerId: userId }],
    },
  });

  if (tools.length === 0) return undefined;

  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      endpoint: tool.endpoint,
      method: tool.method,
      inputType: tool.inputType,
      outputType: tool.outputType,
      config: tool.config,
    })),
  };
}

async function getActiveInstructions(userId: string): Promise<string | undefined> {
  const instructions = await prisma.instruction.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  if (instructions.length === 0) return undefined;
  return instructions.map((i) => i.content).join("\n\n");
}

export const worker = new Worker<JobData>(
  "jobs",
  async (job: Job<JobData>) => {
    const { jobId } = job.data;

    const dbJob = await prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      include: { user: true },
    });

    await prisma.job.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    const executor = new CopilotExecutor();
    const events: CopilotEvent[] = [];

    executor.on("event", (event: CopilotEvent) => {
      events.push(event);

      if (event.type === "thinking") return;

      // Redis Pub/Sub へ非同期配信（エラーは握り潰さずログ出力）
      redis.publish(`job:${jobId}`, JSON.stringify(event)).catch((err: unknown) => {
        console.error(`Redis publish error for job ${jobId}:`, err);
      });

      // JobLog テーブルへ非同期保存
      prisma.jobLog
        .create({
          data: {
            jobId,
            eventType: event.type,
            content: JSON.stringify(event),
          },
        })
        .catch((err: unknown) => {
          console.error(`JobLog save error for job ${jobId}:`, err);
        });
    });

    try {
      const githubToken = await refreshTokenIfNeeded(dbJob.userId);

      const [mcpConfig, instructions] = await Promise.all([
        getMcpConfig(dbJob.userId),
        getActiveInstructions(dbJob.userId),
      ]);

      await executor.execute({
        jobId,
        prompt: dbJob.prompt,
        repository: dbJob.repository,
        branch: dbJob.branch,
        githubToken,
        mcpConfig,
        instructions,
      });

      const prUrl = extractPrUrl(events);
      const doneEvent = events.find((e) => e.type === "done");

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          prUrl,
          resultSummary: doneEvent?.summary,
        },
      });
    } catch (error) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "FAILED", completedAt: new Date() },
      });
      throw error;
    } finally {
      await cleanupWorkDir(jobId);
    }
  },
  {
    connection: bullmqConnection,
    concurrency: 3,
  },
);
