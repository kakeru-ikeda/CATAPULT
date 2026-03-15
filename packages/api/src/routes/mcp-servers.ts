import { PrismaClient, type Prisma } from "@prisma/client";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";

import { auditLog } from "../middleware/audit-log.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const prisma = new PrismaClient();

const router: Router = createRouter();

// ---- 個人 MCP サーバー ----

// 一覧 GET /api/mcp-servers
router.get("/", authMiddleware, async (req: Request, res: Response) => {
  const start = Number(req.query["_start"] ?? 0);
  const end = Number(req.query["_end"] ?? 10);
  const sort = (req.query["_sort"] as string | undefined) ?? "createdAt";
  const order = (req.query["_order"] as string | undefined) ?? "DESC";

  const filter = { ownerId: req.user!.id, isGlobal: false };

  const [items, total] = await Promise.all([
    prisma.mcpServer.findMany({
      where: filter,
      orderBy: { [sort]: order.toLowerCase() },
      skip: start,
      take: end - start,
    }),
    prisma.mcpServer.count({ where: filter }),
  ]);

  res.setHeader("Content-Range", `mcp-servers ${start}-${end}/${total}`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");
  res.json(items);
});

// 作成 POST /api/mcp-servers
router.post("/", authMiddleware, async (req: Request, res: Response) => {
  const { name, serverKey, config, enabled } = req.body as {
    name: string;
    serverKey: string;
    config: Record<string, unknown>;
    enabled?: boolean;
  };

  if (!name || !serverKey || !config) {
    res.status(400).json({ error: "name, serverKey, config は必須です" });
    return;
  }

  const server = await prisma.mcpServer.create({
    data: {
      name,
      serverKey,
      config: config as Prisma.InputJsonValue,
      enabled: enabled ?? true,
      isGlobal: false,
      ownerId: req.user!.id,
    },
  });
  await auditLog(req.user!.id, "mcp-server.create", `mcp-server:${server.id}`, {
    name,
    serverKey,
  });
  res.status(201).json(server);
});

// ---- グローバル MCP サーバー ----

// NOTE: /:id より先に登録することで "global" を /:id に奪われないようにする

// グローバル一覧 GET /api/mcp-servers/global (認証済みユーザー)
router.get("/global", authMiddleware, async (req: Request, res: Response) => {
  const start = Number(req.query["_start"] ?? 0);
  const end = Number(req.query["_end"] ?? 10);
  const sort = (req.query["_sort"] as string | undefined) ?? "createdAt";
  const order = (req.query["_order"] as string | undefined) ?? "DESC";

  const [items, total] = await Promise.all([
    prisma.mcpServer.findMany({
      where: { isGlobal: true },
      orderBy: { [sort]: order.toLowerCase() },
      skip: start,
      take: end - start,
    }),
    prisma.mcpServer.count({ where: { isGlobal: true } }),
  ]);

  res.setHeader("Content-Range", `mcp-servers/global ${start}-${end}/${total}`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");
  res.json(items);
});

// グローバル作成 POST /api/mcp-servers/global (管理者)
router.post("/global", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const { name, serverKey, config, enabled } = req.body as {
    name: string;
    serverKey: string;
    config: Record<string, unknown>;
    enabled?: boolean;
  };

  if (!name || !serverKey || !config) {
    res.status(400).json({ error: "name, serverKey, config は必須です" });
    return;
  }

  const server = await prisma.mcpServer.create({
    data: {
      name,
      serverKey,
      config: config as Prisma.InputJsonValue,
      enabled: enabled ?? true,
      isGlobal: true,
      ownerId: null,
    },
  });
  await auditLog(req.user!.id, "mcp-server.create.global", `mcp-server:${server.id}`, {
    name,
    serverKey,
  });
  res.status(201).json(server);
});

// グローバル詳細 GET /api/mcp-servers/global/:id (認証済みユーザー)
router.get("/global/:id", authMiddleware, async (req: Request, res: Response) => {
  const server = await prisma.mcpServer.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!server) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(server);
});

// グローバル更新 PUT /api/mcp-servers/global/:id (管理者)
router.put("/global/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const { name, serverKey, config, enabled } = req.body as {
    name?: string;
    serverKey?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
  };

  const updated = await prisma.mcpServer.update({
    where: { id: req.params["id"] as string },
    data: { name, serverKey, config: config as Prisma.InputJsonValue | undefined, enabled },
  });
  await auditLog(req.user!.id, "mcp-server.update.global", `mcp-server:${updated.id}`, { name });
  res.json(updated);
});

// グローバル削除 DELETE /api/mcp-servers/global/:id (管理者)
router.delete(
  "/global/:id",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    await prisma.mcpServer.delete({ where: { id: req.params["id"] as string } });
    await auditLog(
      req.user!.id,
      "mcp-server.delete.global",
      `mcp-server:${req.params["id"] as string}`,
    );
    res.json({ id: req.params["id"] as string });
  },
);

// ---- 個人 MCP サーバー (ID 指定) ----

// 詳細 GET /api/mcp-servers/:id
router.get("/:id", authMiddleware, async (req: Request, res: Response) => {
  const server = await prisma.mcpServer.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!server) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (server.ownerId !== req.user!.id && req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(server);
});

// 更新 PUT /api/mcp-servers/:id
router.put("/:id", authMiddleware, async (req: Request, res: Response) => {
  const server = await prisma.mcpServer.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!server) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (server.ownerId !== req.user!.id && req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { name, serverKey, config, enabled } = req.body as {
    name?: string;
    serverKey?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
  };

  const updated = await prisma.mcpServer.update({
    where: { id: req.params["id"] as string },
    data: { name, serverKey, config: config as Prisma.InputJsonValue | undefined, enabled },
  });
  await auditLog(req.user!.id, "mcp-server.update", `mcp-server:${updated.id}`, { name });
  res.json(updated);
});

// 削除 DELETE /api/mcp-servers/:id
router.delete("/:id", authMiddleware, async (req: Request, res: Response) => {
  const server = await prisma.mcpServer.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!server) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (server.ownerId !== req.user!.id && req.user!.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await prisma.mcpServer.delete({ where: { id: req.params["id"] as string } });
  await auditLog(req.user!.id, "mcp-server.delete", `mcp-server:${req.params["id"] as string}`);
  res.json({ id: req.params["id"] as string });
});

export { router as mcpServersRouter };
