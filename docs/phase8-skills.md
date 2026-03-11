# Phase 8: Skills 機能実装

## 目的

GitHub Copilot CLI の Skills 機能を CATAPULT に統合します。  
管理者はグローバルスキルを、利用者は個人スキルをそれぞれ管理でき、  
ジョブ実行時に Copilot CLI が自律的に適切なスキルを選択・適用します。

詳細設計は [`docs/skills.md`](./skills.md) を参照してください。

## 期間目安

**3〜4日**

## タスク一覧

### 1. Prisma スキーマの更新

`prisma/schema.prisma` に `SkillScope` enum と `Skill` モデルを追加します。

```prisma
// prisma/schema.prisma

enum SkillScope {
    GLOBAL
    USER
}

model Skill {
    id          String     @id @default(cuid())
    name        String
    displayName String
    description String
    content     String
    scope       SkillScope @default(USER)
    ownerId     String?
    enabled     Boolean    @default(true)
    version     String     @default("1.0.0")
    sourceZip   Bytes?
    createdAt   DateTime   @default(now())
    updatedAt   DateTime   @updatedAt

    owner User? @relation(fields: [ownerId], references: [id], onDelete: Cascade)

    @@unique([name, scope, ownerId])
    @@index([scope, enabled])
}
```

`User` モデルにリレーションを追加します:

```prisma
model User {
    // ...既存フィールド（変更なし）...
    skills       Skill[]   // 追加
}
```

マイグレーション実行:

```bash
npx prisma migrate dev --name add_skills
```

### 2. skill-deployer.ts の実装

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

export async function deploySkills(
  userId: string,
  homeDir: string,
): Promise<string | null> {
  const skills = await getActiveSkills(userId);
  if (skills.length === 0) return null;

  const skillsDir = path.join(homeDir, ".copilot", "skills");
  await mkdir(skillsDir, { recursive: true });

  for (const skill of skills) {
    // パストラバーサル対策: name は英数字とハイフンのみ
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(skill.name)) {
      console.warn(`[skill-deployer] スキル名が不正なためスキップします: "${skill.name}"`);
      continue;
    }

    const skillDir = path.join(skillsDir, skill.name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), skill.content, "utf8");
  }

  return skillsDir;
}

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

### 3. executor.ts の更新

`--skills-dir` フラグを Copilot CLI 引数に追加します。

```typescript
// packages/worker/src/executor.ts（既存ファイルに追記）

import { deploySkills } from "./skill-deployer";

// CopilotExecutor.execute() 内で呼び出し（既存の homeDir セットアップの後）
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

### 4. Skills CRUD API の実装

```typescript
// packages/api/src/routes/skills.ts

import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { prisma } from "../prisma";

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

  // name バリデーション（パストラバーサル対策）
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) {
    return res.status(400).json({ error: "name は小文字英数字とハイフンのみ使用できます" });
  }

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

### 5. ReactAdmin 設定画面の実装

#### 管理者向け: グローバルスキル設定

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

export const GlobalSkillEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="name" label="スキル名" validate={required()} />
      <TextInput source="displayName" label="表示名" validate={required()} />
      <TextInput source="description" label="説明" multiline validate={required()} />
      <TextInput source="content" label="SKILL.md 全文" multiline validate={required()} />
      <TextInput source="version" label="バージョン" />
      <BooleanInput source="enabled" label="有効" />
    </SimpleForm>
  </Edit>
);
```

#### 利用者向け: 個人スキル管理

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

export const MySkillEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="name" label="スキル名" validate={required()} />
      <TextInput source="displayName" label="表示名" validate={required()} />
      <TextInput source="description" label="説明" multiline validate={required()} />
      <TextInput source="content" label="SKILL.md 全文" multiline validate={required()} />
      <BooleanInput source="enabled" label="有効" />
    </SimpleForm>
  </Edit>
);
```

### 6. API ルーティング登録

```typescript
// packages/api/src/index.ts（既存ファイルに追記）

import skillsRouter from "./routes/skills";

app.use("/api/skills", skillsRouter);
```

## 成果物

- `prisma/schema.prisma` - Skill モデル追加（更新）
- `prisma/migrations/add_skills/` - マイグレーション（新規）
- `packages/worker/src/skill-deployer.ts` - スキルデプロイモジュール（新規）
- `packages/worker/src/executor.ts` - Skills 統合（更新）
- `packages/api/src/routes/skills.ts` - Skills CRUD API（新規）
- `packages/frontend/src/pages/admin/GlobalSkillConfig.tsx` - 管理者向けスキル設定（新規）
- `packages/frontend/src/pages/user/MySkills.tsx` - 利用者向けスキル管理（新規）

## 完了条件

- [ ] Prisma スキーマに `Skill` モデルが追加され、マイグレーションが正常に適用される
- [ ] 管理者がグローバルスキルを CRUD できる
- [ ] 一般ユーザーが個人スキルを CRUD できる
- [ ] 一般ユーザーがグローバルスキルを CRUD しようとすると 403 が返る
- [ ] ジョブ実行時に有効なスキルが `homeDir/.copilot/skills/<name>/SKILL.md` に書き出される
- [ ] `--skills-dir` フラグが Copilot CLI に渡される
- [ ] スキルが 0 件の場合は `--skills-dir` フラグが付かない
- [ ] `name` に不正な文字列（`..` や `/` など）が含まれるスキルは配置されない
- [ ] グローバルスキルと個人スキルが両方ジョブに適用される
- [ ] ReactAdmin の設定画面からスキルの作成・編集・削除ができる
