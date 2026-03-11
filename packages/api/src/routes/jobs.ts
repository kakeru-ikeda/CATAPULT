import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import Redis from "ioredis";

import { auditLog } from "../middleware/audit-log.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const prisma = new PrismaClient();
const redis = new Redis(process.env["REDIS_URL"]!);
const jobQueue = new Queue("jobs", { connection: { url: process.env["REDIS_URL"]! } });

const router: Router = createRouter();

// 自分のジョブ一覧 GET /api/jobs
router.get("/", authMiddleware, async (req: Request, res: Response) => {
  const start = Number(req.query["_start"] ?? 0);
  const end = Number(req.query["_end"] ?? 10);
  const sort = (req.query["_sort"] as string | undefined) ?? "createdAt";
  const order = (req.query["_order"] as string | undefined) ?? "DESC";
  const filter: Record<string, unknown> = { userId: req.user!.id };

  const [items, total] = await Promise.all([
    prisma.job.findMany({
      where: filter,
      orderBy: { [sort]: order.toLowerCase() },
      skip: start,
      take: end - start,
      include: { user: { select: { githubUsername: true } } },
    }),
    prisma.job.count({ where: filter }),
  ]);

  res.setHeader("Content-Range", `jobs ${start}-${end}/${total}`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");
  res.json(items);
});

// 全ユーザーのジョブ一覧 GET /api/jobs/all (管理者)
// NOTE: /:id より先に登録することで "all" を /:id に奪われないようにする
router.get("/all", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const start = Number(req.query["_start"] ?? 0);
  const end = Number(req.query["_end"] ?? 10);
  const sort = (req.query["_sort"] as string | undefined) ?? "createdAt";
  const order = (req.query["_order"] as string | undefined) ?? "DESC";

  const [items, total] = await Promise.all([
    prisma.job.findMany({
      orderBy: { [sort]: order.toLowerCase() },
      skip: start,
      take: end - start,
      include: { user: { select: { githubUsername: true } } },
    }),
    prisma.job.count(),
  ]);

  res.setHeader("Content-Range", `jobs ${start}-${end}/${total}`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");
  res.json(items);
});

// ジョブ詳細 GET /api/jobs/:id
router.get("/:id", authMiddleware, async (req: Request, res: Response) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params["id"] as string },
    include: { user: { select: { githubUsername: true } } },
  });
  if (!job) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (job.userId !== req.user!.id && req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(job);
});

// ジョブ作成 POST /api/jobs
router.post("/", authMiddleware, async (req: Request, res: Response) => {
  const {
    repository,
    branch,
    prompt,
    deliverableType = "pr",
  } = req.body as {
    repository?: string;
    branch?: string;
    prompt?: string;
    deliverableType?: string;
  };

  if (!repository || !branch || !prompt) {
    res.status(400).json({ error: "repository, branch, prompt are required" });
    return;
  }

  const validDeliverableTypes = ["pr", "report", "commit_only", "review"];
  if (!validDeliverableTypes.includes(deliverableType)) {
    res.status(400).json({ error: "Invalid deliverableType" });
    return;
  }

  const dbDeliverableType =
    deliverableType === "pr"
      ? ("PR" as const)
      : deliverableType === "report"
        ? ("REPORT" as const)
        : deliverableType === "commit_only"
          ? ("COMMIT_ONLY" as const)
          : ("REVIEW" as const);

  const job = await prisma.job.create({
    data: {
      userId: req.user!.id,
      repository,
      branch,
      prompt,
      status: "PENDING",
      platform: "API",
      deliverableType: dbDeliverableType,
    },
  });

  await jobQueue.add("execute", { jobId: job.id });

  await auditLog(req.user!.id, "job.create", `job:${job.id}`, { repository, branch });

  res.status(201).json(job);
});

// ジョブキャンセル DELETE /api/jobs/:id
router.delete("/:id", authMiddleware, async (req: Request, res: Response) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!job) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (job.userId !== req.user!.id && req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (job.status !== "PENDING" && job.status !== "RUNNING") {
    res.status(400).json({ error: "Job is not cancellable" });
    return;
  }

  await prisma.job.update({
    where: { id: job.id },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  await auditLog(req.user!.id, "job.cancel", `job:${job.id}`, { repository: job.repository });

  res.json({ id: job.id });
});

// SSE ストリーム GET /api/jobs/:id/stream
router.get("/:id/stream", authMiddleware, async (req: Request, res: Response) => {
  const jobId = (req.params["id"] as string as string | undefined) ?? "";

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (job.userId !== req.user!.id && req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // 既存ログを送信
  const logs = await prisma.jobLog.findMany({
    where: { jobId },
    orderBy: { timestamp: "asc" },
  });
  for (const log of logs) {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  }

  // 完了済みジョブはストリーム終了
  if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
    res.end();
    return;
  }

  // Redis Pub/Sub で新着イベントをリアルタイム配信
  const subscriber = redis.duplicate();
  await subscriber.subscribe(`job:${String(jobId)}`);

  subscriber.on("message", (_channel: string, message: string) => {
    res.write(`data: ${message}\n\n`);
  });

  req.on("close", () => {
    void subscriber.unsubscribe();
    void subscriber.quit();
  });
});

export { router as jobsRouter };
