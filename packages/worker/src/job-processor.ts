import { PrismaClient } from "@prisma/client";
import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

import { CopilotExecutor, type CopilotEvent } from "./executor.js";
import { extractPrUrl } from "./output-parser.js";
import { cleanupWorkDir } from "./sandbox.js";
import { refreshTokenIfNeeded } from "./token-refresher.js";

export const prisma = new PrismaClient();
// Redis pub/sub 配信用（ioredis インスタンス）
export const redis = new Redis(process.env["REDIS_URL"]!);
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
  return instructions.map((i) => `## ${i.name}\n${i.content}`).join("\n\n");
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

    // ノイズの高いストリーミングイベントは Redis 配信をスキップ
    const SKIP_PUBSUB_TYPES = new Set([
      "thinking",
      "assistant.message_delta",
      "assistant.reasoning_delta",
      "assistant.turn_start",
      "assistant.turn_end",
      "user.message",
    ]);

    executor.on("event", (event: CopilotEvent) => {
      events.push(event);

      if (!SKIP_PUBSUB_TYPES.has(event.type)) {
        // Redis Pub/Sub へ非同期配信（エラーは握り潰さずログ出力）
        redis.publish(`job:${jobId}`, JSON.stringify(event)).catch((err: unknown) => {
          console.error(`Redis publish error for job ${jobId}:`, err);
        });
      }

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

      // 前回ジョブのサマリーを取得（軽量セッション）
      let previousContext: string | undefined;
      if (dbJob.parentJobId) {
        const parentJob = await prisma.job.findUnique({
          where: { id: dbJob.parentJobId },
          select: { resultSummary: true, prUrl: true },
        });
        if (parentJob?.resultSummary) {
          previousContext = parentJob.prUrl
            ? `${parentJob.resultSummary}\n\nPR: ${parentJob.prUrl}`
            : parentJob.resultSummary;
        }
      }

      await executor.execute({
        jobId,
        prompt: dbJob.prompt,
        repository: dbJob.repository,
        branch: dbJob.branch,
        githubToken,
        mcpConfig,
        instructions,
        previousContext,
      });

      const prUrl = extractPrUrl(events);

      // Copilot CLI v1.x では assistant.message の content に最終サマリーが含まれる
      const lastAssistantMsg = [...events]
        .reverse()
        .find(
          (e) =>
            e.type === "assistant.message" &&
            typeof e.data?.content === "string" &&
            e.data.content.trim(),
        );
      const summary =
        lastAssistantMsg?.data?.content ??
        events.find((e) => e.type === "done")?.summary ??
        "タスクが完了しました";

      // Relay がジョブ完了を検知できるよう明示的に done イベントを送信
      await redis.publish(`job:${jobId}`, JSON.stringify({ type: "done", summary, prUrl }));

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          prUrl,
          resultSummary: summary,
        },
      });
    } catch (error) {
      // Relay がエラーを検知できるよう error イベントを送信
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      redis
        .publish(`job:${jobId}`, JSON.stringify({ type: "error", message: errMsg }))
        .catch(() => {});

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
