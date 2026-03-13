import { PrismaClient } from "@prisma/client";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";

import { auditLog } from "../middleware/audit-log.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const prisma = new PrismaClient();

const router: Router = createRouter();

// ─── グローバルインストラクション (管理者) ────────────────────────────────────

// グローバルインストラクション一覧 GET /api/instructions/global (管理者)
// NOTE: /:id より先に登録することで "global" を /:id に奪われないようにする
router.get("/global", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const start = Number(req.query["_start"] ?? 0);
  const end = Number(req.query["_end"] ?? 10);
  const sort = (req.query["_sort"] as string | undefined) ?? "createdAt";
  const order = (req.query["_order"] as string | undefined) ?? "DESC";

  const [items, total] = await Promise.all([
    prisma.instruction.findMany({
      where: { isGlobal: true },
      orderBy: { [sort]: order.toLowerCase() },
      skip: start,
      take: end - start,
    }),
    prisma.instruction.count({ where: { isGlobal: true } }),
  ]);

  res.setHeader("Content-Range", `instructions/global ${start}-${end}/${total}`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");
  res.json(items);
});

// グローバルインストラクション作成 POST /api/instructions/global (管理者)
router.post("/global", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const { name, content, isActive } = req.body as {
    name: string;
    content: string;
    isActive?: boolean;
  };

  const instruction = await prisma.instruction.create({
    data: {
      name,
      content,
      isActive: isActive ?? true,
      isGlobal: true,
      userId: null,
    },
  });
  await auditLog(req.user!.id, "instruction.create.global", `instruction:${instruction.id}`, {
    name,
  });
  res.status(201).json(instruction);
});

// グローバルインストラクション詳細 GET /api/instructions/global/:id (管理者)
router.get("/global/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const instruction = await prisma.instruction.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!instruction) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(instruction);
});

// グローバルインストラクション更新 PUT /api/instructions/global/:id (管理者)
router.put("/global/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const { name, content, isActive } = req.body as {
    name?: string;
    content?: string;
    isActive?: boolean;
  };

  const updated = await prisma.instruction.update({
    where: { id: req.params["id"] as string },
    data: { name, content, isActive },
  });
  await auditLog(req.user!.id, "instruction.update.global", `instruction:${updated.id}`, { name });
  res.json(updated);
});

// グローバルインストラクション削除 DELETE /api/instructions/global/:id (管理者)
router.delete(
  "/global/:id",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    await prisma.instruction.delete({ where: { id: req.params["id"] as string } });
    await auditLog(
      req.user!.id,
      "instruction.delete.global",
      `instruction:${req.params["id"] as string}`,
    );
    res.json({ id: req.params["id"] as string });
  },
);

// ─── 個人インストラクション ───────────────────────────────────────────────────

// インストラクション一覧 GET /api/instructions (自分のみ)
router.get("/", authMiddleware, async (req: Request, res: Response) => {
  const start = Number(req.query["_start"] ?? 0);
  const end = Number(req.query["_end"] ?? 10);
  const sort = (req.query["_sort"] as string | undefined) ?? "createdAt";
  const order = (req.query["_order"] as string | undefined) ?? "DESC";

  const filter = { userId: req.user!.id, isGlobal: false };

  const [items, total] = await Promise.all([
    prisma.instruction.findMany({
      where: filter,
      orderBy: { [sort]: order.toLowerCase() },
      skip: start,
      take: end - start,
    }),
    prisma.instruction.count({ where: filter }),
  ]);

  res.setHeader("Content-Range", `instructions ${start}-${end}/${total}`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");
  res.json(items);
});

// インストラクション詳細 GET /api/instructions/:id
router.get("/:id", authMiddleware, async (req: Request, res: Response) => {
  const instruction = await prisma.instruction.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!instruction) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (instruction.userId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(instruction);
});

// インストラクション作成 POST /api/instructions
router.post("/", authMiddleware, async (req: Request, res: Response) => {
  const { name, content, isActive } = req.body as {
    name: string;
    content: string;
    isActive?: boolean;
  };

  const instruction = await prisma.instruction.create({
    data: {
      name,
      content,
      isActive: isActive ?? true,
      isGlobal: false,
      userId: req.user!.id,
    },
  });
  res.status(201).json(instruction);
});

// インストラクション更新 PUT /api/instructions/:id
router.put("/:id", authMiddleware, async (req: Request, res: Response) => {
  const instruction = await prisma.instruction.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!instruction) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (instruction.userId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { name, content, isActive } = req.body as {
    name?: string;
    content?: string;
    isActive?: boolean;
  };

  const updated = await prisma.instruction.update({
    where: { id: req.params["id"] as string },
    data: { name, content, isActive },
  });
  res.json(updated);
});

// インストラクション削除 DELETE /api/instructions/:id
router.delete("/:id", authMiddleware, async (req: Request, res: Response) => {
  const instruction = await prisma.instruction.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!instruction) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (instruction.userId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await prisma.instruction.delete({ where: { id: req.params["id"] as string } });
  res.json({ id: req.params["id"] as string });
});

export { router as instructionsRouter };
