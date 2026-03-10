import { PrismaClient } from "@prisma/client";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";

import { authMiddleware } from "../middleware/auth.js";

const prisma = new PrismaClient();

const router: Router = createRouter();

// インストラクション一覧 GET /api/instructions (自分のみ)
router.get("/", authMiddleware, async (req: Request, res: Response) => {
  const start = Number(req.query["_start"] ?? 0);
  const end = Number(req.query["_end"] ?? 10);
  const sort = (req.query["_sort"] as string | undefined) ?? "createdAt";
  const order = (req.query["_order"] as string | undefined) ?? "DESC";

  const filter = { userId: req.user!.id };

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
