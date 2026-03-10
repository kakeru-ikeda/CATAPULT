import { PrismaClient } from "@prisma/client";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import Redis from "ioredis";

import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const prisma = new PrismaClient();
const redis = new Redis(process.env["REDIS_URL"]!);

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

// 全ユーザーのジョブ一覧 GET /api/jobs/all (管理者)
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

export { router as jobsRouter };
