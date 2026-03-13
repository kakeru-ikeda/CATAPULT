import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { PrismaClient } from "@prisma/client";
import JSZip from "jszip";

const prisma = new PrismaClient();

/** スキル名バリデーション用正規表現（パストラバーサル対策） */
const VALID_SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * アクティブなスキルをファイルシステムに書き出す。
 * sourceZip がある場合は ZIP 全体を展開し、ない場合は SKILL.md のみ書き出す。
 */
export async function deploySkills(userId: string, homeDir: string): Promise<void> {
  const skills = await prisma.skill.findMany({
    where: {
      enabled: true,
      OR: [{ scope: "GLOBAL" }, { scope: "USER", ownerId: userId }],
    },
    orderBy: { createdAt: "asc" },
    select: { name: true, content: true, sourceZip: true },
  });

  if (skills.length === 0) return;

  const skillsDir = path.join(homeDir, ".copilot", "skills");
  await mkdir(skillsDir, { recursive: true });

  for (const skill of skills) {
    // パストラバーサル対策: name は小文字英数字とハイフンのみ
    if (!VALID_SKILL_NAME.test(skill.name)) {
      console.warn(`[skill-deployer] スキル名が不正なためスキップします: "${skill.name}"`);
      continue;
    }

    const skillDir = path.join(skillsDir, skill.name);
    await mkdir(skillDir, { recursive: true });

    if (skill.sourceZip) {
      // ZIP 全体を展開（SKILL.md 以外のスクリプト・設定ファイルも含む）
      const zip = await JSZip.loadAsync(skill.sourceZip);
      for (const [relativePath, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;

        // パストラバーサル対策: .. を含むパスを拒否
        const normalized = path.normalize(relativePath);
        if (normalized.startsWith("..")) {
          console.warn(`[skill-deployer] 不正なパスをスキップします: "${relativePath}"`);
          continue;
        }

        // ZIP のトップレベルフォルダ（スキル名フォルダ）があれば除去してフラット化
        const parts = normalized.split(path.sep);
        const filePath =
          parts.length > 1 && !parts[0]!.includes(".")
            ? path.join(skillDir, ...parts.slice(1))
            : path.join(skillDir, normalized);

        await mkdir(path.dirname(filePath), { recursive: true });
        const content = await entry.async("nodebuffer");
        await writeFile(filePath, content);
      }
    } else {
      // sourceZip がない場合（直接入力されたスキル）は SKILL.md のみ書き出す
      await writeFile(path.join(skillDir, "SKILL.md"), skill.content, "utf8");
    }
  }
}
