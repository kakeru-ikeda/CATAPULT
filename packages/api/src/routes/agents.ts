import crypto from "crypto";

import { PrismaClient } from "@prisma/client";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import Redis from "ioredis";

import { adminMiddleware, authMiddleware } from "../middleware/auth.js";

import { extractCompletionFromLogs } from "./agent-completion.js";

const prisma = new PrismaClient();
const redis = new Redis(process.env["REDIS_URL"]!);

const router: Router = createRouter();

// agentToken から LocalAgent を取得するヘルパー
async function getAgentByToken(
  req: Request,
  res: Response,
): Promise<{ id: string; userId: string } | null> {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const agent = await prisma.localAgent.findUnique({
    where: { agentToken: token },
    select: { id: true, userId: true },
  });
  if (!agent) {
    res.status(401).json({ error: "Invalid agent token" });
    return null;
  }
  return agent;
}

// POST /api/agents/register - エージェント初回登録
router.post("/register", authMiddleware, async (req: Request, res: Response) => {
  const { name, workspaceRoot } = req.body as {
    name?: string;
    workspaceRoot?: string;
  };

  if (!workspaceRoot) {
    res.status(400).json({ error: "workspaceRoot is required" });
    return;
  }

  const agentName = name ?? "agent";
  const agentToken = `cat_agent_${crypto.randomBytes(24).toString("hex")}`;

  const agent = await prisma.localAgent.create({
    data: {
      userId: req.user!.id,
      name: agentName,
      workspaceRoot,
      agentToken,
      status: "OFFLINE",
    },
  });

  res.json({ agentToken: agent.agentToken, agentId: agent.id });
});

// POST /api/agents/heartbeat - 生存確認・ONLINE 更新
router.post("/heartbeat", async (req: Request, res: Response) => {
  const agent = await getAgentByToken(req, res);
  if (!agent) return;

  await prisma.localAgent.update({
    where: { id: agent.id },
    data: {
      status: "ONLINE",
      lastHeartbeatAt: new Date(),
    },
  });

  // 自分宛ての pendingJob を検索
  const pendingJob = await prisma.job.findFirst({
    where: {
      localAgentId: agent.id,
      status: "PENDING",
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  res.json({
    status: "ok",
    pendingJobId: pendingJob?.id ?? null,
  });
});

// GET /api/agents/me - 自分のエージェント状態取得
router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  await prisma.localAgent.updateMany({
    where: {
      userId: req.user!.id,
      status: "ONLINE",
      lastHeartbeatAt: { not: null, lt: oneMinuteAgo },
    },
    data: { status: "OFFLINE" },
  });

  const agents = await prisma.localAgent.findMany({
    where: { userId: req.user!.id },
    select: {
      id: true,
      name: true,
      status: true,
      workspaceRoot: true,
      lastHeartbeatAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  res.json({ agents });
});

// GET /api/agents - 全エージェント一覧（管理者のみ）
router.get("/", authMiddleware, adminMiddleware, async (_req: Request, res: Response) => {
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  await prisma.localAgent.updateMany({
    where: { status: "ONLINE", lastHeartbeatAt: { not: null, lt: oneMinuteAgo } },
    data: { status: "OFFLINE" },
  });

  const agents = await prisma.localAgent.findMany({
    include: {
      user: {
        include: {
          accountLinks: {
            select: { platform: true, platformUserId: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const result = agents.map((a) => ({
    id: a.id,
    userId: a.userId,
    name: a.name,
    userSlackId: a.user.accountLinks.find((l) => l.platform === "SLACK")?.platformUserId,
    userDiscordId: a.user.accountLinks.find((l) => l.platform === "DISCORD")?.platformUserId,
    status: a.status,
    workspaceRoot: a.workspaceRoot,
    lastHeartbeatAt: a.lastHeartbeatAt?.toISOString() ?? null,
  }));

  res.json({ agents: result });
});

// POST /api/agents/jobs/claim - PENDING ジョブを 1 件取得し RUNNING に変更
router.post("/jobs/claim", async (req: Request, res: Response) => {
  const agent = await getAgentByToken(req, res);
  if (!agent) return;

  // トランザクションで排他的に取得
  const job = await prisma.$transaction(async (tx) => {
    const pendingJob = await tx.job.findFirst({
      where: {
        localAgentId: agent.id,
        status: "PENDING",
      },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { id: true, githubToken: true } },
      },
    });

    if (!pendingJob) return null;

    await tx.job.update({
      where: { id: pendingJob.id },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    return pendingJob;
  });

  if (!job) {
    res.status(404).json({ error: "No pending job" });
    return;
  }

  // user のグローバルインストラクションを取得
  const activeInstructions = await prisma.instruction.findMany({
    where: {
      userId: job.user.id,
      isActive: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const instructions =
    activeInstructions.length > 0
      ? activeInstructions.map((i) => `## ${i.name}\n${i.content}`).join("\n\n")
      : undefined;

  // トークンを復号（AES-256-GCM）
  let githubToken = "";
  try {
    const { decrypt } = await import("../services/token-vault.js");
    githubToken = decrypt(job.user.githubToken);
  } catch {
    res.status(500).json({ error: "Failed to decrypt GitHub token" });
    return;
  }

  // スレッド内の会話履歴を時系列で取得（最大 10 ターン）
  const conversationHistory: Array<{ prompt: string; summary: string; prUrl?: string }> = [];
  if (job.threadId) {
    const threadJobs = await prisma.job.findMany({
      where: {
        userId: job.user.id,
        threadId: job.threadId,
        status: "COMPLETED",
        id: { not: job.id },
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
  }

  res.json({
    jobId: job.id,
    repository: job.repository,
    branch: job.branch,
    prompt: job.prompt,
    deliverableType: job.deliverableType.toLowerCase(),
    instructions,
    conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
    githubToken,
  });
});

// POST /api/agents/jobs/:jobId/events - イベント送信
router.post("/jobs/:jobId/events", async (req: Request, res: Response) => {
  const agent = await getAgentByToken(req, res);
  if (!agent) return;

  const { jobId } = req.params as { jobId: string };

  // ジョブが自分宛てか確認
  const job = await prisma.job.findFirst({
    where: { id: jobId, localAgentId: agent.id },
    select: { id: true },
  });

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const { events } = req.body as {
    events?: Array<{ type: string; data: unknown; timestamp: string }>;
  };

  if (!Array.isArray(events)) {
    res.status(400).json({ error: "events must be an array" });
    return;
  }

  // JobLog に保存（thinking は除く）
  const logsToSave = events
    .filter((e) => e.type !== "thinking")
    .map((e) => ({
      jobId,
      eventType: e.type,
      content: JSON.stringify(e), // イベント全体を保存（complete 時に data?.content を参照するため）
      timestamp: new Date(e.timestamp),
    }));

  if (logsToSave.length > 0) {
    await prisma.jobLog.createMany({ data: logsToSave });
  }

  // Redis Pub/Sub でイベントを配信（Bot が購読）
  for (const event of events) {
    await redis.publish(`job:${jobId}`, JSON.stringify(event));
  }

  res.json({ received: events.length });
});

// POST /api/agents/jobs/:jobId/complete - ジョブ完了通知
router.post("/jobs/:jobId/complete", async (req: Request, res: Response) => {
  const agent = await getAgentByToken(req, res);
  if (!agent) return;

  const { jobId } = req.params as { jobId: string };
  const { status, error, summary, prUrl } = req.body as {
    status?: "COMPLETED" | "FAILED";
    error?: string;
    summary?: string;
    prUrl?: string;
  };

  if (status !== "COMPLETED" && status !== "FAILED") {
    res.status(400).json({ error: "status must be COMPLETED or FAILED" });
    return;
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, localAgentId: agent.id },
    select: { id: true },
  });

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // extractCompletionFromLogs ではなく、ローカルエージェントから送られた summary を優先使用
  let finalSummary = summary;
  let finalPrUrl = prUrl;

  if (!finalSummary) {
    // 互換性のため（未対応エージェントや summary が取れなかった場合）、JobLog からも試みる
    const logs = await prisma.jobLog.findMany({
      where: { jobId },
      select: { eventType: true, content: true },
      orderBy: { id: "asc" },
    });
    const extracted = extractCompletionFromLogs(logs);
    finalSummary = extracted.summary;
    finalPrUrl = finalPrUrl ?? extracted.prUrl;
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status,
      completedAt: new Date(),
      prUrl: finalPrUrl ?? null,
      resultSummary: finalSummary,
      ...(error ? { output: error } : {}),
    },
  });

  // 完了イベントを Redis に配信（workerと同じ形式）
  if (status === "FAILED" && error) {
    await redis.publish(`job:${jobId}`, JSON.stringify({ type: "error", message: error }));
  } else {
    await redis.publish(
      `job:${jobId}`,
      JSON.stringify({ type: "done", summary: finalSummary, prUrl: finalPrUrl }),
    );
  }

  res.json({ ok: true });
});

// POST /api/agents/jobs/:jobId/fallback - サーバー実行へのフォールバック
router.post("/jobs/:jobId/fallback", async (req: Request, res: Response) => {
  const agent = await getAgentByToken(req, res);
  if (!agent) return;

  const { jobId } = req.params as { jobId: string };
  const { reason } = req.body as { reason?: string };

  const job = await prisma.job.findFirst({
    where: { id: jobId, localAgentId: agent.id },
    select: { id: true },
  });

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // ジョブをサーバーモードに切り替えて BullMQ に積む
  // BullMQ を使うために動的インポート
  const { Queue } = await import("bullmq");
  const jobQueue = new Queue("jobs", { connection: { url: process.env["REDIS_URL"]! } });

  await prisma.job.update({
    where: { id: jobId },
    data: {
      executionMode: "SERVER",
      localAgentId: null,
      status: "PENDING",
    },
  });

  await jobQueue.add("execute", { jobId });
  await jobQueue.close();

  await redis.publish(
    `job:${jobId}`,
    JSON.stringify({
      type: "message",
      data: {
        content: `⚠️ ローカルエージェントでリポジトリが見つかりませんでした。サーバー実行に切り替えます。\n理由: ${reason ?? "不明"}`,
      },
      timestamp: new Date().toISOString(),
    }),
  );

  res.json({ ok: true });
});

export { router as agentsRouter };
