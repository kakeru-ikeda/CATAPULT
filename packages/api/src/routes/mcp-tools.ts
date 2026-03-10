import { PrismaClient } from "@prisma/client";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";

import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const prisma = new PrismaClient();

const router: Router = createRouter();

// 個人MCPツール一覧 GET /api/mcp-tools
router.get("/", authMiddleware, async (req: Request, res: Response) => {
  const start = Number(req.query["_start"] ?? 0);
  const end = Number(req.query["_end"] ?? 10);
  const sort = (req.query["_sort"] as string | undefined) ?? "createdAt";
  const order = (req.query["_order"] as string | undefined) ?? "DESC";

  const filter = { ownerId: req.user!.id, isGlobal: false };

  const [items, total] = await Promise.all([
    prisma.mcpTool.findMany({
      where: filter,
      orderBy: { [sort]: order.toLowerCase() },
      skip: start,
      take: end - start,
    }),
    prisma.mcpTool.count({ where: filter }),
  ]);

  res.setHeader("Content-Range", `mcp-tools ${start}-${end}/${total}`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");
  res.json(items);
});

// MCPツール作成 POST /api/mcp-tools
router.post("/", authMiddleware, async (req: Request, res: Response) => {
  const { name, description, endpoint, method, enabled } = req.body as {
    name: string;
    description?: string;
    endpoint: string;
    method?: string;
    enabled?: boolean;
  };

  const tool = await prisma.mcpTool.create({
    data: {
      name,
      description,
      endpoint,
      method: method ?? "POST",
      enabled: enabled ?? true,
      isGlobal: false,
      ownerId: req.user!.id,
    },
  });
  res.status(201).json(tool);
});

// グローバルMCPツール一覧 GET /api/mcp-tools/global (管理者)
// NOTE: /:id より先に登録することで "global" を /:id に奪われないようにする
router.get("/global", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const start = Number(req.query["_start"] ?? 0);
  const end = Number(req.query["_end"] ?? 10);
  const sort = (req.query["_sort"] as string | undefined) ?? "createdAt";
  const order = (req.query["_order"] as string | undefined) ?? "DESC";

  const [items, total] = await Promise.all([
    prisma.mcpTool.findMany({
      where: { isGlobal: true },
      orderBy: { [sort]: order.toLowerCase() },
      skip: start,
      take: end - start,
    }),
    prisma.mcpTool.count({ where: { isGlobal: true } }),
  ]);

  res.setHeader("Content-Range", `mcp-tools/global ${start}-${end}/${total}`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");
  res.json(items);
});

// グローバルMCPツール作成 POST /api/mcp-tools/global (管理者)
router.post("/global", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const { name, description, endpoint, method, enabled } = req.body as {
    name: string;
    description?: string;
    endpoint: string;
    method?: string;
    enabled?: boolean;
  };

  const tool = await prisma.mcpTool.create({
    data: {
      name,
      description,
      endpoint,
      method: method ?? "POST",
      enabled: enabled ?? true,
      isGlobal: true,
      ownerId: null,
    },
  });
  res.status(201).json(tool);
});

// グローバルMCPツール詳細 GET /api/mcp-tools/global/:id (管理者)
router.get("/global/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const tool = await prisma.mcpTool.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!tool) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(tool);
});

// グローバルMCPツール更新 PUT /api/mcp-tools/global/:id (管理者)
router.put("/global/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const { name, description, endpoint, method, enabled } = req.body as {
    name?: string;
    description?: string;
    endpoint?: string;
    method?: string;
    enabled?: boolean;
  };

  const updated = await prisma.mcpTool.update({
    where: { id: req.params["id"] as string },
    data: { name, description, endpoint, method, enabled },
  });
  res.json(updated);
});

// グローバルMCPツール削除 DELETE /api/mcp-tools/global/:id (管理者)
router.delete(
  "/global/:id",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    await prisma.mcpTool.delete({ where: { id: req.params["id"] as string } });
    res.json({ id: req.params["id"] as string });
  },
);

// MCPツール詳細 GET /api/mcp-tools/:id
router.get("/:id", authMiddleware, async (req: Request, res: Response) => {
  const tool = await prisma.mcpTool.findUnique({ where: { id: req.params["id"] as string } });
  if (!tool) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (tool.ownerId !== req.user!.id && req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(tool);
});

// MCPツール更新 PUT /api/mcp-tools/:id
router.put("/:id", authMiddleware, async (req: Request, res: Response) => {
  const tool = await prisma.mcpTool.findUnique({ where: { id: req.params["id"] as string } });
  if (!tool) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (tool.ownerId !== req.user!.id && req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { name, description, endpoint, method, enabled } = req.body as {
    name?: string;
    description?: string;
    endpoint?: string;
    method?: string;
    enabled?: boolean;
  };

  const updated = await prisma.mcpTool.update({
    where: { id: req.params["id"] as string },
    data: { name, description, endpoint, method, enabled },
  });
  res.json(updated);
});

// MCPツール削除 DELETE /api/mcp-tools/:id
router.delete("/:id", authMiddleware, async (req: Request, res: Response) => {
  const tool = await prisma.mcpTool.findUnique({ where: { id: req.params["id"] as string } });
  if (!tool) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (tool.ownerId !== req.user!.id && req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await prisma.mcpTool.delete({ where: { id: req.params["id"] as string } });
  res.json({ id: req.params["id"] as string });
});

export { router as mcpToolsRouter };
