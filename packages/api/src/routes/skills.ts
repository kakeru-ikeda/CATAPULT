import { PrismaClient } from "@prisma/client";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import JSZip from "jszip";
import multer from "multer";

import { auditLog } from "../middleware/audit-log.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";

const prisma = new PrismaClient();

const router: Router = createRouter();

/** スキル名バリデーション用正規表現（パストラバーサル対策） */
const VALID_SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

/** SKILL.md の frontmatter から name / description を抽出 */
function parseSkillMd(content: string): { name: string; description: string } | null {
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const descMatch = content.match(/^description:\s*(.+)$/m);
  if (!nameMatch?.[1] || !descMatch?.[1]) return null;
  return { name: nameMatch[1].trim(), description: descMatch[1].trim() };
}

// ─── 個人スキル (scope=USER) ────────────────────────────────────────────────

// 個人スキル一覧 GET /api/skills
router.get("/", authMiddleware, async (req: Request, res: Response) => {
  const start = Number(req.query["_start"] ?? 0);
  const end = Number(req.query["_end"] ?? 10);
  const sort = (req.query["_sort"] as string | undefined) ?? "createdAt";
  const order = (req.query["_order"] as string | undefined) ?? "DESC";

  const filter = { ownerId: req.user!.id, scope: "USER" as const };

  const [items, total] = await Promise.all([
    prisma.skill.findMany({
      where: filter,
      orderBy: { [sort]: order.toLowerCase() },
      skip: start,
      take: end - start,
    }),
    prisma.skill.count({ where: filter }),
  ]);

  res.setHeader("Content-Range", `skills ${start}-${end}/${total}`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");
  res.json(items);
});

// 個人スキル作成 POST /api/skills
router.post("/", authMiddleware, async (req: Request, res: Response) => {
  const { name, displayName, description, content, enabled, version } = req.body as {
    name: string;
    displayName: string;
    description: string;
    content: string;
    enabled?: boolean;
    version?: string;
  };

  if (!VALID_SKILL_NAME.test(name)) {
    res.status(400).json({ error: "name は小文字英数字とハイフンのみ使用できます" });
    return;
  }

  const skill = await prisma.skill.create({
    data: {
      name,
      displayName,
      description,
      content,
      scope: "USER",
      ownerId: req.user!.id,
      enabled: enabled ?? true,
      version: version ?? "1.0.0",
    },
  });
  await auditLog(req.user!.id, "skill.create", `skill:${skill.id}`, { name });
  res.status(201).json(skill);
});

// 個人スキル ZIP アップロード POST /api/skills/upload
// NOTE: /:id より先に登録
router.post(
  "/upload",
  authMiddleware,
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "ファイルが必要です" });
      return;
    }

    const zip = await JSZip.loadAsync(req.file.buffer).catch(() => null);
    if (!zip) {
      res.status(400).json({ error: "ZIP ファイルの解析に失敗しました" });
      return;
    }

    const skillMdFile = zip.file(/SKILL\.md$/i)[0] ?? null;
    if (!skillMdFile) {
      res.status(400).json({ error: "ZIP 内に SKILL.md が見つかりません" });
      return;
    }

    const content = await skillMdFile.async("string");
    const parsed = parseSkillMd(content);
    if (!parsed) {
      res.status(400).json({ error: "SKILL.md に name または description が含まれていません" });
      return;
    }
    if (!VALID_SKILL_NAME.test(parsed.name)) {
      res.status(400).json({ error: "SKILL.md の name は小文字英数字とハイフンのみ使用できます" });
      return;
    }

    const skill = await prisma.skill.create({
      data: {
        name: parsed.name,
        displayName: parsed.name,
        description: parsed.description,
        content,
        scope: "USER",
        ownerId: req.user!.id,
        sourceZip: req.file.buffer,
      },
    });
    await auditLog(req.user!.id, "skill.upload", `skill:${skill.id}`, { name: parsed.name });
    res.status(201).json(skill);
  },
);

// グローバルスキル一覧 GET /api/skills/global (認証済みユーザー)
// NOTE: /:id より先に登録することで "global" を /:id に奪われないようにする
router.get("/global", authMiddleware, async (req: Request, res: Response) => {
  const start = Number(req.query["_start"] ?? 0);
  const end = Number(req.query["_end"] ?? 10);
  const sort = (req.query["_sort"] as string | undefined) ?? "createdAt";
  const order = (req.query["_order"] as string | undefined) ?? "DESC";

  const [items, total] = await Promise.all([
    prisma.skill.findMany({
      where: { scope: "GLOBAL" },
      orderBy: { [sort]: order.toLowerCase() },
      skip: start,
      take: end - start,
    }),
    prisma.skill.count({ where: { scope: "GLOBAL" } }),
  ]);

  res.setHeader("Content-Range", `skills/global ${start}-${end}/${total}`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");
  res.json(items);
});

// グローバルスキル作成 POST /api/skills/global (管理者)
router.post("/global", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const { name, displayName, description, content, enabled, version } = req.body as {
    name: string;
    displayName: string;
    description: string;
    content: string;
    enabled?: boolean;
    version?: string;
  };

  if (!VALID_SKILL_NAME.test(name)) {
    res.status(400).json({ error: "name は小文字英数字とハイフンのみ使用できます" });
    return;
  }

  const skill = await prisma.skill.create({
    data: {
      name,
      displayName,
      description,
      content,
      scope: "GLOBAL",
      ownerId: null,
      enabled: enabled ?? true,
      version: version ?? "1.0.0",
    },
  });
  await auditLog(req.user!.id, "skill.create.global", `skill:${skill.id}`, { name });
  res.status(201).json(skill);
});

// グローバルスキル ZIP アップロード POST /api/skills/global/upload (管理者)
// NOTE: /global/:id より先に登録
router.post(
  "/global/upload",
  authMiddleware,
  adminMiddleware,
  upload.single("file"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "ファイルが必要です" });
      return;
    }

    const zip = await JSZip.loadAsync(req.file.buffer).catch(() => null);
    if (!zip) {
      res.status(400).json({ error: "ZIP ファイルの解析に失敗しました" });
      return;
    }

    const skillMdFile = zip.file(/SKILL\.md$/i)[0] ?? null;
    if (!skillMdFile) {
      res.status(400).json({ error: "ZIP 内に SKILL.md が見つかりません" });
      return;
    }

    const content = await skillMdFile.async("string");
    const parsed = parseSkillMd(content);
    if (!parsed) {
      res.status(400).json({ error: "SKILL.md に name または description が含まれていません" });
      return;
    }
    if (!VALID_SKILL_NAME.test(parsed.name)) {
      res.status(400).json({ error: "SKILL.md の name は小文字英数字とハイフンのみ使用できます" });
      return;
    }

    const skill = await prisma.skill.create({
      data: {
        name: parsed.name,
        displayName: parsed.name,
        description: parsed.description,
        content,
        scope: "GLOBAL",
        ownerId: null,
        sourceZip: req.file.buffer,
      },
    });
    await auditLog(req.user!.id, "skill.upload.global", `skill:${skill.id}`, {
      name: parsed.name,
    });
    res.status(201).json(skill);
  },
);

// グローバルスキル詳細 GET /api/skills/global/:id (認証済みユーザー)
router.get("/global/:id", authMiddleware, async (req: Request, res: Response) => {
  const skill = await prisma.skill.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!skill) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(skill);
});

// グローバルスキル更新 PUT /api/skills/global/:id (管理者)
router.put("/global/:id", authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const target = await prisma.skill.findUnique({ where: { id: req.params["id"] as string } });
  if (!target) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (target.isSystem) {
    res.status(403).json({ error: "システム組み込みスキルは変更できません" });
    return;
  }

  const { name, displayName, description, content, enabled, version } = req.body as {
    name?: string;
    displayName?: string;
    description?: string;
    content?: string;
    enabled?: boolean;
    version?: string;
  };

  if (name !== undefined && !VALID_SKILL_NAME.test(name)) {
    res.status(400).json({ error: "name は小文字英数字とハイフンのみ使用できます" });
    return;
  }

  const updated = await prisma.skill.update({
    where: { id: req.params["id"] as string },
    data: { name, displayName, description, content, enabled, version },
  });
  await auditLog(req.user!.id, "skill.update.global", `skill:${updated.id}`, { name });
  res.json(updated);
});

// グローバルスキル削除 DELETE /api/skills/global/:id (管理者)
router.delete(
  "/global/:id",
  authMiddleware,
  adminMiddleware,
  async (req: Request, res: Response) => {
    const target = await prisma.skill.findUnique({ where: { id: req.params["id"] as string } });
    if (!target) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (target.isSystem) {
      res.status(403).json({ error: "システム組み込みスキルは削除できません" });
      return;
    }
    await prisma.skill.delete({ where: { id: req.params["id"] as string } });
    await auditLog(req.user!.id, "skill.delete.global", `skill:${req.params["id"] as string}`);
    res.json({ id: req.params["id"] as string });
  },
);

// 個人スキル詳細 GET /api/skills/:id
router.get("/:id", authMiddleware, async (req: Request, res: Response) => {
  const skill = await prisma.skill.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!skill) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (skill.scope === "USER" && skill.ownerId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(skill);
});

// 個人スキル更新 PUT /api/skills/:id
router.put("/:id", authMiddleware, async (req: Request, res: Response) => {
  const skill = await prisma.skill.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!skill) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (skill.scope !== "USER" || skill.ownerId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { name, displayName, description, content, enabled, version } = req.body as {
    name?: string;
    displayName?: string;
    description?: string;
    content?: string;
    enabled?: boolean;
    version?: string;
  };

  if (name !== undefined && !VALID_SKILL_NAME.test(name)) {
    res.status(400).json({ error: "name は小文字英数字とハイフンのみ使用できます" });
    return;
  }

  const updated = await prisma.skill.update({
    where: { id: req.params["id"] as string },
    data: { name, displayName, description, content, enabled, version },
  });
  await auditLog(req.user!.id, "skill.update", `skill:${updated.id}`, { name });
  res.json(updated);
});

// 個人スキル削除 DELETE /api/skills/:id
router.delete("/:id", authMiddleware, async (req: Request, res: Response) => {
  const skill = await prisma.skill.findUnique({
    where: { id: req.params["id"] as string },
  });
  if (!skill) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (skill.scope !== "USER" || skill.ownerId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await prisma.skill.delete({ where: { id: req.params["id"] as string } });
  await auditLog(req.user!.id, "skill.delete", `skill:${req.params["id"] as string}`);
  res.json({ id: req.params["id"] as string });
});

export { router as skillsRouter };
