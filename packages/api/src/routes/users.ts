import { PrismaClient } from "@prisma/client";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";

import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const prisma = new PrismaClient();

const router: Router = createRouter();

// ユーザー一覧 GET /api/users (管理者)
router.get("/", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const start = Number(req.query["_start"] ?? 0);
  const end = Number(req.query["_end"] ?? 10);
  const sort = (req.query["_sort"] as string | undefined) ?? "createdAt";
  const order = (req.query["_order"] as string | undefined) ?? "DESC";

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      orderBy: { [sort]: order.toLowerCase() },
      skip: start,
      take: end - start,
      select: {
        id: true,
        githubUsername: true,
        githubAvatarUrl: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.user.count(),
  ]);

  res.setHeader("Content-Range", `users ${start}-${end}/${total}`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");
  res.json(items);
});

// ユーザー詳細 GET /api/users/:id (管理者)
router.get("/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params["id"] as string },
    select: {
      id: true,
      githubUsername: true,
      githubAvatarUrl: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(user);
});

// ユーザー更新 PUT /api/users/:id (管理者・ロール変更のみ)
router.put("/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const { role } = req.body as { role?: string };
  if (role !== "ADMIN" && role !== "USER") {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  const user = await prisma.user.update({
    where: { id: req.params["id"] as string },
    data: { role },
    select: {
      id: true,
      githubUsername: true,
      githubAvatarUrl: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  res.json(user);
});

export { router as usersRouter };
