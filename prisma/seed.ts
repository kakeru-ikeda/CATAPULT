/**
 * Prisma DB シードスクリプト
 *
 * システム組み込みの GLOBAL スキルを DB に投入する。
 * 冪等（upsert）なので何度実行しても安全。
 *
 * 実行方法:
 *   npx prisma db seed
 *   # または
 *   npx tsx prisma/seed.ts
 */

import { readFile, readdir } from "fs/promises";
import path from "path";

import { PrismaClient } from "@prisma/client";
import JSZip from "jszip";

const prisma = new PrismaClient();

/** シードスクリプトはワークスペースルートから実行される前提 */
const WORKSPACE_ROOT = process.cwd();

/** スキル名バリデーション（パストラバーサル対策） */
const VALID_SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** frontmatter から name / description を抽出 */
function parseSkillMd(content: string): { name: string; description: string } | null {
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const descMatch = content.match(/^description:\s*(.+)$/m);
  if (!nameMatch?.[1] || !descMatch?.[1]) return null;
  return { name: nameMatch[1].trim(), description: descMatch[1].trim() };
}

/** スキル名スラッグを管理画面表示名に変換（例: my-skill → My Skill） */
function slugToDisplayName(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** prisma/system-skills/ 配下の *.zip を動的スキャンして返す */
async function discoverSkillZips(): Promise<string[]> {
  const skillsDir = path.join(WORKSPACE_ROOT, "prisma/system-skills");
  const entries = await readdir(skillsDir);
  return entries.filter((f) => f.endsWith(".zip")).sort();
}

async function seedSystemSkill(zipFileName: string): Promise<void> {
  const zipPath = path.join(WORKSPACE_ROOT, "prisma/system-skills", zipFileName);
  const zipBuffer = await readFile(zipPath);

  const zip = await JSZip.loadAsync(zipBuffer);

  const skillMdFile = zip.file(/SKILL\.md$/i)[0] ?? null;
  if (!skillMdFile) {
    console.warn(`[seed] ${zipFileName}: ZIP 内に SKILL.md が見つかりません。スキップします`);
    return;
  }

  const content = await skillMdFile.async("string");
  const parsed = parseSkillMd(content);
  if (!parsed) {
    console.warn(
      `[seed] ${zipFileName}: SKILL.md に name または description がありません。スキップします`,
    );
    return;
  }
  if (!VALID_SKILL_NAME.test(parsed.name)) {
    console.warn(
      `[seed] ${zipFileName}: SKILL.md の name "${parsed.name}" が不正です。スキップします`,
    );
    return;
  }

  const displayName = slugToDisplayName(parsed.name);

  // upsert: scope=GLOBAL かつ同名スキルが既に存在する場合は更新、なければ新規作成
  const existing = await prisma.skill.findFirst({
    where: { name: parsed.name, scope: "GLOBAL", ownerId: null },
  });

  let skill;
  if (existing) {
    skill = await prisma.skill.update({
      where: { id: existing.id },
      data: {
        displayName,
        description: parsed.description,
        content,
        enabled: true,
        isSystem: true,
        sourceZip: zipBuffer,
        updatedAt: new Date(),
      },
    });
  } else {
    skill = await prisma.skill.create({
      data: {
        name: parsed.name,
        displayName,
        description: parsed.description,
        content,
        scope: "GLOBAL",
        ownerId: null,
        enabled: true,
        isSystem: true,
        sourceZip: zipBuffer,
      },
    });
  }

  console.info(`[seed] Upserted system skill: ${skill.name} (id=${skill.id})`);
}

async function main(): Promise<void> {
  console.info("[seed] Starting DB seed...");

  const zipFiles = await discoverSkillZips();
  console.info(`[seed] Found ${zipFiles.length} skill ZIP(s): ${zipFiles.join(", ")}`);

  for (const zipFile of zipFiles) {
    await seedSystemSkill(zipFile);
  }

  console.info("[seed] Done.");
}

main()
  .catch((e) => {
    console.error("[seed] Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
