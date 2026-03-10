# Phase 6: MCPツール設定・インストラクション管理

## 目的

GitHub Copilot CLI の MCP (Model Context Protocol) ツール設定と、ユーザーのカスタムインストラクションを管理する機能を実装します。グローバル設定と個人設定の2階層で管理します。

## 期間目安

**3〜4日**

## タスク一覧

### 1. MCPツール CRUD API

```typescript
// packages/api/src/routes/mcp-tools.ts

import { Router } from "express";
import { authMiddleware, requireAdmin } from "../middleware/auth";
import { rbacMiddleware } from "../middleware/rbac";

const router = Router();

// 一覧取得（自分のツール + グローバルツール）
router.get("/", authMiddleware, async (req, res) => {
  const tools = await prisma.mcpTool.findMany({
    where: {
      OR: [{ isGlobal: true }, { ownerId: req.user.id }],
    },
  });
  res.json(tools);
});

// 作成（管理者: グローバルツール作成可、利用者: 個人ツールのみ）
router.post("/", authMiddleware, async (req, res) => {
  const { name, description, endpoint, method, isGlobal, config } = req.body;

  if (isGlobal && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "グローバルツールの作成は管理者のみ可能です" });
  }

  const tool = await prisma.mcpTool.create({
    data: {
      name,
      description,
      endpoint,
      method: method ?? "POST",
      isGlobal: isGlobal ?? false,
      ownerId: isGlobal ? null : req.user.id,
      config,
    },
  });

  res.status(201).json(tool);
});

// 更新
router.put("/:id", authMiddleware, async (req, res) => {
  const tool = await prisma.mcpTool.findUniqueOrThrow({ where: { id: req.params.id } });

  // 権限チェック: グローバルツールは管理者のみ、個人ツールは本人のみ
  if (tool.isGlobal && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "権限がありません" });
  }
  if (!tool.isGlobal && tool.ownerId !== req.user.id) {
    return res.status(403).json({ error: "権限がありません" });
  }

  const updated = await prisma.mcpTool.update({
    where: { id: req.params.id },
    data: req.body,
  });

  res.json(updated);
});

// 削除
router.delete("/:id", authMiddleware, async (req, res) => {
  const tool = await prisma.mcpTool.findUniqueOrThrow({ where: { id: req.params.id } });

  if (tool.isGlobal && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "権限がありません" });
  }
  if (!tool.isGlobal && tool.ownerId !== req.user.id) {
    return res.status(403).json({ error: "権限がありません" });
  }

  await prisma.mcpTool.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
```

### 2. グローバル / 個人 MCPツール管理

MCPツールは2階層で管理します:

| 種別       | `isGlobal` | `ownerId` | 管理者  | 利用者     |
| ---------- | ---------- | --------- | ------- | ---------- |
| グローバル | `true`     | `null`    | CRUD 可 | 読み取り可 |
| 個人       | `false`    | User ID   | -       | CRUD 可    |

### 3. MCP設定ファイルの Worker 注入

ジョブ実行時に、適用するMCPツールを `~/.copilot-cli/config.json` に書き出して Copilot CLI に渡します。

```typescript
// packages/worker/src/executor.ts

async function buildMcpConfig(userId: string): Promise<McpConfig> {
  const tools = await prisma.mcpTool.findMany({
    where: {
      enabled: true,
      OR: [{ isGlobal: true }, { ownerId: userId }],
    },
  });

  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      endpoint: tool.endpoint,
      method: tool.method,
      ...(tool.config as object),
    })),
  };
}

// CopilotExecutor.execute() 内で呼び出し
const mcpConfig = await buildMcpConfig(userId);
const homeDir = `/tmp/copilot-jobs/${jobId}/home`;
const configDir = `${homeDir}/.copilot-cli`;
await mkdir(configDir, { recursive: true });
await writeFile(`${configDir}/config.json`, JSON.stringify(mcpConfig, null, 2));
```

### 4. インストラクション CRUD API

```typescript
// packages/api/src/routes/instructions.ts

import { Router } from "express";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// 一覧取得（自分のインストラクションのみ）
router.get("/", authMiddleware, async (req, res) => {
  const instructions = await prisma.instruction.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(instructions);
});

// 作成
router.post("/", authMiddleware, async (req, res) => {
  const instruction = await prisma.instruction.create({
    data: {
      userId: req.user.id,
      name: req.body.name,
      content: req.body.content,
      isActive: req.body.isActive ?? true,
    },
  });
  res.status(201).json(instruction);
});

// 更新
router.put("/:id", authMiddleware, async (req, res) => {
  const instruction = await prisma.instruction.findUniqueOrThrow({
    where: { id: req.params.id },
  });
  if (instruction.userId !== req.user.id) {
    return res.status(403).json({ error: "権限がありません" });
  }
  const updated = await prisma.instruction.update({
    where: { id: req.params.id },
    data: req.body,
  });
  res.json(updated);
});

// 削除
router.delete("/:id", authMiddleware, async (req, res) => {
  const instruction = await prisma.instruction.findUniqueOrThrow({
    where: { id: req.params.id },
  });
  if (instruction.userId !== req.user.id) {
    return res.status(403).json({ error: "権限がありません" });
  }
  await prisma.instruction.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
```

### 5. インストラクション → プロンプト結合

ジョブ実行時に有効なインストラクションをプロンプトに結合して Copilot CLI に渡します。

```typescript
// packages/worker/src/executor.ts

async function getActiveInstructions(userId: string): Promise<string> {
  const instructions = await prisma.instruction.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  if (instructions.length === 0) return "";

  return instructions.map((i) => `## ${i.name}\n${i.content}`).join("\n\n");
}

// プロンプト構築
const instructionsText = await getActiveInstructions(userId);
const fullPrompt = [branchInstruction, instructionsText, userPrompt]
  .filter(Boolean)
  .join("\n\n---\n\n");
```

### 6. ReactAdmin 設定画面

#### 管理者向け: グローバル MCPツール設定

```typescript
// packages/frontend/src/pages/admin/McpToolConfig.tsx

import {
  List,
  Datagrid,
  TextField,
  BooleanField,
  Create,
  SimpleForm,
  TextInput,
  BooleanInput,
  Edit,
} from "react-admin";

export const McpToolConfig = () => (
  <List filter={{ isGlobal: true }}>
    <Datagrid rowClick="edit">
      <TextField source="name" label="ツール名" />
      <TextField source="endpoint" label="エンドポイント" />
      <BooleanField source="enabled" label="有効" />
    </Datagrid>
  </List>
);
```

#### 利用者向け: 個人 MCPツール設定

```typescript
// packages/frontend/src/pages/user/McpToolSettings.tsx

import { List, Datagrid, TextField, BooleanField, Create, Edit, SimpleForm, TextInput, BooleanInput } from "react-admin";

export const McpToolSettings = () => (
  <List>
    <Datagrid rowClick="edit">
      <TextField source="name" label="ツール名" />
      <TextField source="endpoint" label="エンドポイント" />
      <BooleanField source="enabled" label="有効" />
    </Datagrid>
  </List>
);
```

#### 利用者向け: インストラクション管理

```typescript
// packages/frontend/src/pages/user/MyInstructions.tsx

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
} from "react-admin";
import { RichTextInput } from "ra-input-rich-text";

export const MyInstructions = () => (
  <List>
    <Datagrid rowClick="edit">
      <TextField source="name" label="名前" />
      <BooleanField source="isActive" label="有効" />
    </Datagrid>
  </List>
);
```

## 成果物

- `packages/api/src/routes/mcp-tools.ts` - MCPツール CRUD API
- `packages/api/src/routes/instructions.ts` - インストラクション CRUD API
- `packages/worker/src/executor.ts` (MCP設定注入の更新)
- `packages/frontend/src/pages/admin/McpToolConfig.tsx` - 管理者向けMCPツール設定
- `packages/frontend/src/pages/user/McpToolSettings.tsx` - 利用者向けMCPツール設定
- `packages/frontend/src/pages/user/MyInstructions.tsx` - インストラクション管理

## 完了条件

- [ ] 管理者がグローバル MCPツールを CRUD できる
- [ ] 利用者が個人 MCPツールを CRUD できる
- [ ] 利用者がグローバルツールを CRUD しようとするとエラーになる
- [ ] ジョブ実行時にMCP設定ファイルが Worker の HOME に書き出される
- [ ] 有効なインストラクションがプロンプトに結合される
- [ ] 無効化されたインストラクションは Copilot に渡されない
- [ ] ReactAdmin の設定画面から設定が保存される
