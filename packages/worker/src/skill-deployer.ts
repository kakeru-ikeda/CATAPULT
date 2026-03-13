import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface SkillEntry {
  name: string;
  content: string;
}

/** スキル名バリデーション用正規表現（パストラバーサル対策） */
const VALID_SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * アクティブなスキルをファイルシステムに書き出し、--skills-dir パスを返す。
 * スキルが 0 件の場合は null を返す。
 */
export async function deploySkills(userId: string, homeDir: string): Promise<string | null> {
  const skills = await getActiveSkills(userId);
  if (skills.length === 0) return null;

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
    await writeFile(path.join(skillDir, "SKILL.md"), skill.content, "utf8");
  }

  return skillsDir;
}

/**
 * ユーザーに適用されるアクティブなスキルを DB から取得。
 * GLOBAL スキル（全ユーザー）+ USER スキル（本人のみ）を合算して返す。
 */
export async function getActiveSkills(userId: string): Promise<SkillEntry[]> {
  const skills = await prisma.skill.findMany({
    where: {
      enabled: true,
      OR: [{ scope: "GLOBAL" }, { scope: "USER", ownerId: userId }],
    },
    orderBy: { createdAt: "asc" },
  });

  return skills.map((skill) => ({
    name: skill.name,
    content: skill.content,
  }));
}
