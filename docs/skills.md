# CATAPULT - Skills 機能設計

## 概要

GitHub Copilot CLI の **Skills** 機能を CATAPULT に統合します。  
Skills とは、エージェントが特定タスクを実行する際に参照する手順書（`SKILL.md`）です。  
管理画面から Skills を登録・管理でき、ジョブ実行時に Copilot CLI が自律的に選択・適用します。

参考: [Creating agent skills for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills)

---

## Skills とは何か・なぜプロンプト注入ではないのか

### Copilot CLI における Skills の仕組み

Copilot CLI は起動時に以下のディレクトリをスキャンし、`SKILL.md` ファイルを自律的にロードします。

```
# リポジトリスコープ（デフォルト検索パス）
/.github/skills/<skill-name>/SKILL.md

# ユーザーグローバルスコープ（--skills-dir フラグで追加）
/.copilot/skills/<skill-name>/SKILL.md
```

`SKILL.md` の `description` フィールドを見て、Copilot がタスク内容に応じて **自律的に** 適用するスキルを選択します。  
これは「プロンプトに文字列として埋め込む」とは根本的に異なる動作です。

### プロンプト注入との違い

| 方式                                     | 説明                                                  | 問題点                                                                 |
| ---------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| ❌ プロンプト注入                        | SKILL.md の内容を `-p` のプロンプトに文字列として展開 | ただの長いインストラクションと同じ。Copilot が Skills として認識しない |
| ✅ ファイルシステム配置 + `--skills-dir` | `SKILL.md` をファイルとして配置し CLI フラグで教える  | Copilot が Skills として認識し、description をもとに自律選択・適用する |

### CATAPULT での正しいフロー

```
[DB: Skill テーブル]
  ↓ getActiveSkills(userId)
[job-processor.ts]
  ↓ SkillEntry[] を executor に渡す
[executor.ts: writeSkills()]
  → homeDir/.copilot/skills/<name>/SKILL.md をファイルとして書き出す
  ↓
[copilot --autopilot --skills-dir homeDir/.copilot/skills -p "..."]
  ↓
[Copilot CLI が起動時に --skills-dir を読み込み]
  → description をもとにタスクに合うスキルを自律選択
  → SKILL.md の手順に従って行動する
```

---

## SKILL.md のフォーマット

```markdown
---
name: my-skill
description: このスキルが適用されるべき状況の説明（Copilot の自動選択に使われる）
---

## 手順

1. ステップ1
2. ステップ2
3. ステップ3
```

- `name`: スキルのディレクトリ名と一致させる（小文字ハイフン形式）
- `description`: **Copilot がスキルを自律選択する際に参照する最重要フィールド**。タスクとの関連性をここで判断する

---

## スコープ設計

### 権限マトリクス

|                         | グローバルスキル (scope=GLOBAL) | 個人スキル (scope=USER) |
| ----------------------- | ------------------------------- | ----------------------- |
| **管理者 (ADMIN)**      | ✅ CRUD                         | ❌ 操作不可             |
| **一般ユーザー (USER)** | 👁️ 閲覧のみ（自動適用）         | ✅ CRUD                 |

### 既存機能との対応関係

Skills のスコープ設計は既存の MCP ツールと同じパターンを踏襲します。

| 機能         | グローバル管理フィールド | 個人管理フィールド           |
| ------------ | ------------------------ | ---------------------------- |
| MCP ツール   | `isGlobal=true`          | `ownerId=userId`             |
| **Skills**   | `scope=GLOBAL`           | `scope=USER, ownerId=userId` |
| Instructions | なし（個人のみ）         | `userId`                     |

---

## データモデル

### Prisma スキーマへの追加

```prisma
// prisma/schema.prisma に追加

enum SkillScope {
    GLOBAL  // 管理者が管理、全ユーザーの全ジョブに適用
    USER    // ユーザー個人のスキル、そのユーザーのジョブのみ
}

model Skill {
    id          String     @id @default(cuid())
    name        String     // スキルディレクトリ名（小文字ハイフン形式、例: "pr-review"）
    displayName String     // 管理画面表示名
    description String     // SKILL.md の description フィールド（Copilot の自律選択に使われる）
    content     String     // SKILL.md 全文（YAML frontmatter + Markdown 本文）
    scope       SkillScope @default(USER)
    ownerId     String?    // scope=GLOBAL の場合は null
    enabled     Boolean    @default(true)
    version     String     @default("1.0.0")
    sourceZip   Bytes?     // ZIP アップロード時の元データ保存（サイズ制限は API 層の multer で 10MB に強制）
    createdAt   DateTime   @default(now())
    updatedAt   DateTime   @updatedAt

    owner User? @relation(fields: [ownerId], references: [id], onDelete: Cascade)

    @@unique([name, scope, ownerId])
    @@index([scope, enabled])
}
```

### User モデルへのリレーション追加

```prisma
model User {
    // ...既存フィールド（変更なし）...
    skills       Skill[]   // 追加
}
```

### フィールド詳細

| フィールド    | 型         | 説明                                                                                                         |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `name`        | String     | ファイルシステム上のディレクトリ名。小文字ハイフン形式。`@@unique([name, scope, ownerId])` でスコープ内一意  |
| `displayName` | String     | 管理画面での表示名                                                                                           |
| `description` | String     | Copilot CLI がスキルを自律選択する際に参照するフィールド。SKILL.md の frontmatter `description` と一致させる |
| `content`     | String     | SKILL.md の全文（frontmatter 込み）。Worker 実行時にそのままファイルに書き出す                               |
| `scope`       | SkillScope | `GLOBAL`（全ユーザーに適用）/ `USER`（個人スキル）                                                           |
| `ownerId`     | String?    | `scope=USER` の場合のユーザーID。`scope=GLOBAL` の場合は null                                                |
| `enabled`     | Boolean    | 無効にするとジョブ実行時に配置されない                                                                       |
| `sourceZip`   | Bytes?     | ZIP アップロード時の元ファイル。再ダウンロード用に保存                                                       |

---

## Prisma マイグレーション

```sql
-- マイグレーション名: add_skills

CREATE TYPE "SkillScope" AS ENUM ('GLOBAL', 'USER');

CREATE TABLE "Skill" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content"     TEXT NOT NULL,
    "scope"       "SkillScope" NOT NULL DEFAULT 'USER',
    "ownerId"     TEXT,
    "enabled"     BOOLEAN NOT NULL DEFAULT true,
    "version"     TEXT NOT NULL DEFAULT '1.0.0',
    "sourceZip"   BYTEA,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Skill_name_scope_ownerId_key" ON "Skill"("name", "scope", "ownerId");
CREATE INDEX "Skill_scope_enabled_idx" ON "Skill"("scope", "enabled");

ALTER TABLE "Skill"
    ADD CONSTRAINT "Skill_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## Worker 統合設計

### skill-deployer.ts（新規）

```typescript
// packages/worker/src/skill-deployer.ts

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface SkillEntry {
  name: string;
  content: string;
}

/**
 * アクティブなスキルをファイルシステムに書き出し、--skills-dir パスを返す
 */
export async function deploySkills(userId: string, homeDir: string): Promise<string | null> {
  const skills = await getActiveSkills(userId);
  if (skills.length === 0) return null;

  const skillsDir = path.join(homeDir, ".copilot", "skills");
  await mkdir(skillsDir, { recursive: true });

  for (const skill of skills) {
    const skillDir = path.join(skillsDir, skill.name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), skill.content, "utf8");
  }

  return skillsDir;
}

/**
 * ユーザーに適用されるアクティブなスキルを DB から取得
 * GLOBAL スキル（全ユーザー）+ USER スキル（本人のみ）を合算
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
```

### executor.ts への統合

```typescript
// packages/worker/src/executor.ts（既存ファイルに追記）

import { deploySkills } from "./skill-deployer";

// CopilotExecutor.execute() 内で呼び出し
const homeDir = `/tmp/copilot-jobs/${jobId}/home`;
const skillsDir = await deploySkills(userId, homeDir);

// Copilot CLI 引数の構築
const args = [
  "--autopilot",
  "--allow-all",
  "--output",
  "json",
  ...(skillsDir ? ["--skills-dir", skillsDir] : []),
  "-p",
  fullPrompt,
];
```

---

## API 設計

### Skills CRUD エンドポイント

```typescript
// packages/api/src/routes/skills.ts

import { Router } from "express";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// 一覧取得（自分のスキル + グローバルスキル）
router.get("/", authMiddleware, async (req, res) => {
  const skills = await prisma.skill.findMany({
    where: {
      OR: [{ scope: "GLOBAL" }, { scope: "USER", ownerId: req.user.id }],
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(skills);
});

// 作成
router.post("/", authMiddleware, async (req, res) => {
  const { name, displayName, description, content, scope, version } = req.body;

  if (scope === "GLOBAL" && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "グローバルスキルの作成は管理者のみ可能です" });
  }

  const skill = await prisma.skill.create({
    data: {
      name,
      displayName,
      description,
      content,
      scope: scope ?? "USER",
      ownerId: scope === "GLOBAL" ? null : req.user.id,
      version: version ?? "1.0.0",
    },
  });
  res.status(201).json(skill);
});

// 更新
router.put("/:id", authMiddleware, async (req, res) => {
  const skill = await prisma.skill.findUnique({ where: { id: req.params.id } });
  if (!skill) return res.status(404).json({ error: "指定されたスキルが見つかりません" });

  if (skill.scope === "GLOBAL" && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "権限がありません" });
  }
  if (skill.scope === "USER" && skill.ownerId !== req.user.id) {
    return res.status(403).json({ error: "権限がありません" });
  }

  // 更新可能フィールドのみ許可（scope/ownerId/id の変更を防ぐ）
  const { name, displayName, description, content, enabled, version } = req.body;
  const updated = await prisma.skill.update({
    where: { id: req.params.id },
    data: { name, displayName, description, content, enabled, version },
  });
  res.json(updated);
});

// 削除
router.delete("/:id", authMiddleware, async (req, res) => {
  const skill = await prisma.skill.findUnique({ where: { id: req.params.id } });
  if (!skill) return res.status(404).json({ error: "指定されたスキルが見つかりません" });

  if (skill.scope === "GLOBAL" && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "権限がありません" });
  }
  if (skill.scope === "USER" && skill.ownerId !== req.user.id) {
    return res.status(403).json({ error: "権限がありません" });
  }

  await prisma.skill.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
```

### ZIP アップロードエンドポイント

```typescript
// packages/api/src/routes/skills.ts（続き）

import multer from "multer";
import JSZip from "jszip";

const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// ZIP ファイルから SKILL.md を展開してスキルを作成
router.post("/upload", authMiddleware, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ファイルが必要です" });

  const zip = await JSZip.loadAsync(req.file.buffer);
  const skillMdFiles = zip.file(/SKILL\.md$/i);
  const skillMdFile = skillMdFiles.length > 0 ? skillMdFiles[0] : null;

  if (!skillMdFile) {
    return res.status(400).json({ error: "ZIP 内に SKILL.md が見つかりません" });
  }

  const content = await skillMdFile.async("string");

  // frontmatter から name/description を抽出
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const descMatch = content.match(/^description:\s*(.+)$/m);

  if (!nameMatch || !descMatch) {
    return res
      .status(400)
      .json({ error: "SKILL.md に name または description が含まれていません" });
  }

  const skill = await prisma.skill.create({
    data: {
      name: nameMatch[1].trim(),
      displayName: nameMatch[1].trim(),
      description: descMatch[1].trim(),
      content,
      scope: "USER",
      ownerId: req.user.id,
      sourceZip: req.file.buffer,
    },
  });

  res.status(201).json(skill);
});
```

---

## ReactAdmin 設計

### 管理者向け: グローバルスキル管理

```typescript
// packages/frontend/src/pages/admin/GlobalSkillConfig.tsx

import {
  List,
  Datagrid,
  TextField,
  BooleanField,
  Create,
  Edit,
  SimpleForm,
  TextInput,
  BooleanInput,
  required,
} from "react-admin";

export const GlobalSkillList = () => (
  <List filter={{ scope: "GLOBAL" }}>
    <Datagrid rowClick="edit">
      <TextField source="name" label="スキル名" />
      <TextField source="displayName" label="表示名" />
      <TextField source="description" label="説明" />
      <TextField source="version" label="バージョン" />
      <BooleanField source="enabled" label="有効" />
    </Datagrid>
  </List>
);

export const GlobalSkillCreate = () => (
  <Create>
    <SimpleForm defaultValues={{ scope: "GLOBAL" }}>
      <TextInput source="name" label="スキル名（小文字ハイフン形式）" validate={required()} />
      <TextInput source="displayName" label="表示名" validate={required()} />
      <TextInput source="description" label="説明（Copilot の自律選択に使用）" multiline validate={required()} />
      <TextInput source="content" label="SKILL.md 全文" multiline validate={required()} />
      <BooleanInput source="enabled" label="有効" defaultValue={true} />
    </SimpleForm>
  </Create>
);
```

### 利用者向け: 個人スキル管理

```typescript
// packages/frontend/src/pages/user/MySkills.tsx

import {
  List,
  Datagrid,
  TextField,
  BooleanField,
  Create,
  Edit,
  SimpleForm,
  TextInput,
  BooleanInput,
  required,
} from "react-admin";

export const MySkillList = () => (
  <List filter={{ scope: "USER" }}>
    <Datagrid rowClick="edit">
      <TextField source="name" label="スキル名" />
      <TextField source="displayName" label="表示名" />
      <TextField source="description" label="説明" />
      <BooleanField source="enabled" label="有効" />
    </Datagrid>
  </List>
);

export const MySkillCreate = () => (
  <Create>
    <SimpleForm defaultValues={{ scope: "USER" }}>
      <TextInput source="name" label="スキル名（小文字ハイフン形式）" validate={required()} />
      <TextInput source="displayName" label="表示名" validate={required()} />
      <TextInput source="description" label="説明（Copilot の自律選択に使用）" multiline validate={required()} />
      <TextInput source="content" label="SKILL.md 全文" multiline validate={required()} />
      <BooleanInput source="enabled" label="有効" defaultValue={true} />
    </SimpleForm>
  </Create>
);
```

---

## セキュリティ考慮事項

### SKILL.md コンテンツのバリデーション

- `name` フィールド: 小文字英数字とハイフンのみ許可（パストラバーサル対策）
  - 正規表現: `/^[a-z0-9][a-z0-9-]{0,62}$/`
- `content` フィールド: 最大 100KB
- `sourceZip` フィールド: 最大 10MB

### ファイルシステム配置時の安全性

- スキルディレクトリは必ず `homeDir/.copilot/skills/<name>/` に限定
- `name` に `..` や `/` を含む場合は拒否
- ジョブ完了後にジョブディレクトリごと削除（`/tmp/copilot-jobs/{jobId}/`）

---

## 成果物

- `packages/worker/src/skill-deployer.ts` - スキルデプロイモジュール（新規）
- `packages/worker/src/executor.ts` - Skills 統合（更新）
- `packages/api/src/routes/skills.ts` - Skills CRUD API（新規）
- `packages/frontend/src/pages/admin/GlobalSkillConfig.tsx` - 管理者向けスキル設定（新規）
- `packages/frontend/src/pages/user/MySkills.tsx` - 利用者向けスキル管理（新規）
- `prisma/schema.prisma` - Skill モデル追加（更新）
- `prisma/migrations/add_skills/` - マイグレーション（新規）
