import { readFile } from "fs/promises";
import path from "path";

import type { CopilotEvent } from "@catapult/core";
import { extractFinalAssistantMessage, extractPrUrl, extractWorkerBranch } from "@catapult/core";
import { PrismaClient } from "@prisma/client";
import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

import { CopilotExecutor, detectBranchFromWorkDir } from "./executor.js";
import { createPullRequest, extractPrTitle } from "./github-pr.js";
import { cleanupWorkDir } from "./sandbox.js";
import { refreshTokenIfNeeded } from "./token-refresher.js";

export const prisma = new PrismaClient();
// Redis pub/sub 配信用（ioredis インスタンス）
export const redis = new Redis(process.env["REDIS_URL"]!);
// BullMQ は独自バンドルの ioredis を使うため URL オプションで接続
const bullmqConnection = { url: process.env["REDIS_URL"]! };

/**
 * DB 接続を保証する。アイドル後に接続が切断された場合はリトライして再接続する。
 * Prisma の $connect() は接続済みなら冪等（no-op）。
 */
async function ensureDbConnection(retries = 3): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await prisma.$connect();
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`[DB] Connection failed, reconnecting... (${attempt}/${retries})`);
      await prisma.$disconnect().catch(() => {});
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

interface JobData {
  jobId: string;
}

async function getMcpConfig(userId: string): Promise<object | undefined> {
  const servers = await prisma.mcpServer.findMany({
    where: {
      enabled: true,
      OR: [{ isGlobal: true }, { ownerId: userId }],
    },
  });

  if (servers.length === 0) return undefined;

  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) {
    mcpServers[server.serverKey] = server.config;
  }

  return { mcpServers };
}

async function getActiveInstructions(userId: string): Promise<string | undefined> {
  const instructions = await prisma.instruction.findMany({
    where: {
      isActive: true,
      OR: [{ isGlobal: true }, { userId }],
    },
    // グローバルを先に、ユーザー定義を後に並べることでユーザー定義が優先される
    orderBy: [{ isGlobal: "desc" }, { createdAt: "asc" }],
  });

  if (instructions.length === 0) return undefined;
  return instructions.map((i) => `## ${i.name}\n${i.content}`).join("\n\n");
}

export function createWorker(): Worker<JobData> {
  return new Worker<JobData>(
    "jobs",
    async (job: Job<JobData>) => {
      const { jobId } = job.data;

      // アイドル後の DB 接続切断に備え、クエリ前に接続を保証する
      await ensureDbConnection();

      const dbJob = await prisma.job.findUniqueOrThrow({
        where: { id: jobId },
        include: { user: true },
      });

      console.info(
        `[Job ${jobId}] Received: user=${dbJob.userId}, repo=${dbJob.repository}:${dbJob.branch}`,
      );

      // キューイング中にキャンセルされた場合はスキップ
      if (dbJob.status === "CANCELLED") {
        console.info(`[Job ${jobId}] Skipped (already CANCELLED)`);
        return;
      }

      await prisma.job.update({
        where: { id: jobId },
        data: { status: "RUNNING", startedAt: new Date() },
      });
      console.info(`[Job ${jobId}] Status → RUNNING`);

      const executor = new CopilotExecutor();
      const events: CopilotEvent[] = [];
      let cancelled = false;

      // キャンセル信号を購読（subscriber インスタンスは subscribe 中は他コマンド不可のため専用接続）
      const cancelSubscriber = new Redis(process.env["REDIS_URL"]!);
      await cancelSubscriber.subscribe(`job:${jobId}:cancel`);
      cancelSubscriber.once("message", () => {
        cancelled = true;
        executor.cancel();
      });

      // ノイズの高いストリーミングイベントは Redis 配信をスキップ
      const SKIP_PUBSUB_TYPES = new Set([
        "thinking",
        "assistant.message_delta",
        "assistant.reasoning_delta",
        "assistant.turn_start",
        "assistant.turn_end",
        "user.message",
      ]);

      // 進捗として標準出力に表示するイベントタイプ
      const LOG_EVENT_TYPES = new Set([
        "tool_call",
        "tool_result",
        "file_write",
        "shell_call",
        "shell_result",
        "done",
        "error",
      ]);

      executor.on("event", (event: CopilotEvent) => {
        events.push(event);

        if (LOG_EVENT_TYPES.has(event.type)) {
          const detail = event.data?.toolName ?? event.tool ?? event.command ?? event.message ?? "";
          console.info(
            `[Job ${jobId}] [${event.type}]${detail ? " " + String(detail).slice(0, 120) : ""}`,
          );
        }

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

        // スレッド内の会話履歴を時系列で取得（最大 10 ターン）
        const conversationHistory: Array<{ prompt: string; summary: string; prUrl?: string }> = [];
        if (dbJob.threadId) {
          const threadJobs = await prisma.job.findMany({
            where: {
              userId: dbJob.userId,
              threadId: dbJob.threadId,
              status: "COMPLETED",
              id: { not: dbJob.id },
            },
            orderBy: { completedAt: "asc" },
            take: 10,
            select: { prompt: true, resultSummary: true, prUrl: true },
          });
          for (const j of threadJobs) {
            if (j.resultSummary) {
              conversationHistory.push({
                prompt: j.prompt,
                summary: j.resultSummary,
                prUrl: j.prUrl ?? undefined,
              });
            }
          }
          if (conversationHistory.length > 0) {
            console.info(
              `[Job ${jobId}] Loaded ${conversationHistory.length} conversation turn(s) from thread`,
            );
          }
        }

        console.info(
          `[Job ${jobId}] Starting Copilot executor (deliverable=${dbJob.deliverableType ?? "PR"})...`,
        );
        await executor.execute({
          jobId,
          userId: dbJob.userId,
          prompt: dbJob.prompt,
          repository: dbJob.repository,
          branch: dbJob.branch,
          githubToken,
          mcpConfig,
          instructions,
          conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
          branchMode:
            dbJob.parentJobId !== null && dbJob.deliverableType === "COMMIT_ONLY"
              ? "existing"
              : "new",
          deliverableType:
            dbJob.deliverableType === "PR"
              ? "pr"
              : dbJob.deliverableType === "REPORT"
                ? "report"
                : dbJob.deliverableType === "COMMIT_ONLY"
                  ? "commit_only"
                  : "review",
          model: dbJob.model ?? undefined,
        });

        // extractPrUrl はフォールバック用（Autopilot が gh pr create を実行した場合）
        const extractedPrUrl = extractPrUrl(events);
        const workerBranch =
          extractWorkerBranch(events, jobId) ?? (await detectBranchFromWorkDir(jobId));

        // ファイルベースでの最終回答の取得を優先する
        let summary: string;
        try {
          const workDir = `/tmp/copilot-jobs/${jobId}/workspace`;
          const summaryFilePath = path.join(workDir, "CATAPULT_SUMMARY.md");
          summary = await readFile(summaryFilePath, "utf-8");
        } catch {
          const fallbackMessage = extractFinalAssistantMessage(events);
          summary = fallbackMessage
            ? `⚠️ **サマリーファイルが生成されずにプロセスが終了しました**\n\n【最後のアシスタント発言】\n${fallbackMessage}`
            : "タスクが完了しました（報告内容の生成なし）";
        }

        // CATAPULT 側で PR を作成（deliverableType=PR かつブランチが確定している場合）
        let prUrl = extractedPrUrl;
        if (
          !prUrl &&
          dbJob.deliverableType === "PR" &&
          dbJob.repository &&
          workerBranch &&
          workerBranch !== dbJob.branch
        ) {
          try {
            console.info(`[Job ${jobId}] Creating PR via GitHub API (branch: ${workerBranch})...`);
            prUrl = await createPullRequest({
              githubToken,
              repository: dbJob.repository,
              head: workerBranch,
              base: dbJob.branch,
              title: extractPrTitle(summary),
              body: summary,
            });
            console.info(`[Job ${jobId}] PR created: ${prUrl}`);
          } catch (prErr) {
            console.error(`[Job ${jobId}] PR creation failed:`, prErr);
            // PR作成失敗はジョブ全体の失敗にはしない
          }
        }

        // Relay がジョブ完了を検知できるよう明示的に done イベントを送信
        await redis.publish(`job:${jobId}`, JSON.stringify({ type: "done", summary, prUrl }));

        console.info(`[Job ${jobId}] Status → COMPLETED${prUrl ? ` (PR: ${prUrl})` : ""}`);
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            prUrl,
            workerBranch: workerBranch ?? null,
            resultSummary: summary,
          },
        });
      } catch (error) {
        // キャンセルされた場合は CANCELLED ステータスに更新し、リスローしない（BullMQ のリトライ対象外）
        if (cancelled) {
          console.info(`[Job ${jobId}] Status → CANCELLED`);
          await redis
            .publish(`job:${jobId}`, JSON.stringify({ type: "cancelled" }))
            .catch(() => {});
          await prisma.job.update({
            where: { id: jobId },
            data: { status: "CANCELLED", completedAt: new Date() },
          });
          return;
        }

        // Relay がエラーを検知できるよう error イベントを送信
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[Job ${jobId}] Status → FAILED: ${errMsg}`);
        redis
          .publish(`job:${jobId}`, JSON.stringify({ type: "error", message: errMsg }))
          .catch(() => {});

        try {
          await prisma.job.update({
            where: { id: jobId },
            data: { status: "FAILED", completedAt: new Date() },
          });
        } catch (updateErr) {
          console.error(`Failed to update job status to FAILED for job ${jobId}:`, updateErr);
        }
        throw error;
      } finally {
        void cancelSubscriber
          .unsubscribe(`job:${jobId}:cancel`)
          .then(() => cancelSubscriber.disconnect())
          .catch(() => {});
        await cleanupWorkDir(jobId);
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 3,
    },
  );
}
