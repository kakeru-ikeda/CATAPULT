# CATAPULT - モデル選択機能設計

## 概要

Slack/Discord の Bot UI からユーザーが GitHub Copilot CLI の実行モデルを選択できるようにします。利用可能なモデルは Worker 起動時に `copilot --help` をパースして DB に保管し、Admin UI から有効/無効を管理できます。

---

## 設計方針

### なぜモデルリストを埋め込まないか

`copilot --help` の出力には `--model` の `choices:` として利用可能なモデル名が列挙されています。these をソースコードにハードコードすると、CLI アップデートのたびに手動更新が必要になります。

代わりに **Worker 起動時に CLI をパースして DB に保管** し、Bot は DB 経由でリストを取得します。

### なぜ `SystemSetting` (KV) ではなく専用テーブルか

既存の `Skill`・`McpTool`・`Instruction` テーブルはすべて「リソース単位でレコードを持ち、`enabled` フラグで有効/無効を切り替える」パターンに統一されています。

`CopilotModel` テーブルも同じパターンに従うことで：

- `WHERE enabled = true` のような SQL クエリが可能
- Admin UI から行単位で有効/無効を切り替えられる
- `displayName` や将来の属性（`costTier` 等）を追加しやすい

---

## データベース変更

### 新テーブル: `CopilotModel`

```prisma
// prisma/schema.prisma

model CopilotModel {
    id          String   @id @default(cuid())
    name        String   @unique  // CLI の値そのまま（例: "claude-sonnet-4.6"）
    displayName String?           // 表示名（省略時は name をそのまま表示）
    enabled     Boolean  @default(true)  // false: ドロップダウンに表示しない
    sortOrder   Int      @default(0)     // ドロップダウンの表示順（昇順）
    createdAt   DateTime @default(now())
    updatedAt   DateTime @updatedAt
}
```

### `Job` テーブルへの追加フィールド

```prisma
model Job {
    // ...既存フィールド...
    model  String?   // null = Auto（--model フラグなし）
}
```

---

## バックエンド変更

### Worker: 起動時にモデルリストを同期

```typescript
// packages/worker/src/utils.ts に追加

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * copilot --help の出力から --model の choices を抽出して返す
 */
export async function parseAvailableModels(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("copilot", ["--help"]);
    // --model セクションから choices: "..." を抽出
    const section = stdout.match(/--model <model>.*?(?=\n {2}--|$)/s)?.[0] ?? "";
    const models = [...section.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    return models;
  } catch {
    return [];
  }
}
```

```typescript
// packages/worker/src/index.ts に追加（起動時処理）

import { parseAvailableModels } from "./utils.js";

async function syncCopilotModels(): Promise<void> {
  const models = await parseAvailableModels();
  if (models.length === 0) return;

  for (const [index, name] of models.entries()) {
    await prisma.copilotModel.upsert({
      where: { name },
      update: { sortOrder: index }, // 順序だけ更新、enabled は手動管理を維持
      create: { name, sortOrder: index },
    });
  }
}

// Worker 起動処理の中で呼び出す
await syncCopilotModels();
```

### API: モデルリスト取得エンドポイント

```typescript
// packages/api/src/routes/models.ts (新規)

import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

// GET /api/models
// enabled なモデルを sortOrder 順で返す
router.get("/api/models", async (_req, res) => {
  const models = await prisma.copilotModel.findMany({
    where: { enabled: true },
    orderBy: { sortOrder: "asc" },
    select: { name: true, displayName: true },
  });
  res.json({ models });
  // レスポンス例: { models: [{ name: "claude-sonnet-4.6", displayName: null }, ...] }
});

export { router as modelsRouter };
```

### Worker Executor: `--model` フラグの動的組み立て

```typescript
// packages/worker/src/executor.ts の spawn 引数を変更

const modelArgs = options.model ? ["--model", options.model] : [];

this.proc = spawn(
  "copilot",
  [
    "--autopilot",
    "--allow-all",
    "--output-format", "json",
    ...modelArgs,                              // ← Auto なら空配列
    ...DENIED_TOOLS.flatMap(tool => ["--deny-tool", tool]),
    "-p", fullPrompt,
  ],
  { ... }
);
```

### Core: `ExecuteOptions` への追加

```typescript
// packages/core/src/types.ts

export interface ExecuteOptions {
  jobId: string;
  userId: string;
  prompt: string;
  repository: string;
  branch: string;
  githubToken: string;
  mcpConfig?: object;
  instructions?: string;
  conversationHistory?: ConversationTurn[];
  deliverableType?: DeliverableType;
  model?: string; // ← 追加: undefined = Auto（--model フラグなし）
}
```

---

## Bot UI 変更

### Slack: ブランチ選択モーダルにドロップダウン追加

`interactive.ts` のブランチ選択モーダル（`callback_id: "select_branch"`）の `blocks` に追加します。

**配置位置**（実行環境と完了形式の間）:

```
ブランチ       ← 既存
実行環境       ← 既存（ONLINEエージェントがいる場合のみ）
▶ モデル       ← 新規追加
完了形式       ← 既存
```

```typescript
// packages/bot/src/services/models.ts (新規)

export interface ModelOption {
  name: string;
  displayName: string | null;
}

export async function fetchAvailableModels(): Promise<ModelOption[]> {
  try {
    const res = await fetch(`${process.env["API_BASE_URL"]}/api/models`);
    const data = (await res.json()) as { models: ModelOption[] };
    return data.models;
  } catch {
    return []; // フォールバック: Auto のみ表示
  }
}
```

```typescript
// interactive.ts: ブランチ選択モーダルの blocks 末尾付近に追加

const availableModels = await fetchAvailableModels();

// ...既存 blocks...
{
  type: "input",
  block_id: "model_block",
  optional: true,                   // 未選択 = Auto として扱う
  element: {
    type: "static_select",
    action_id: "model_select",
    initial_option: {
      text: { type: "plain_text", text: "🤖 Auto" },
      value: "auto",
    },
    options: [
      { text: { type: "plain_text", text: "🤖 Auto" }, value: "auto" },
      ...availableModels.map((m) => ({
        text: { type: "plain_text", text: m.displayName ?? m.name },
        value: m.name,
      })),
    ],
  },
  label: { type: "plain_text", text: "モデル" },
},
```

view submission ハンドラでの値取得:

```typescript
const modelValue =
  view.state.values["model_block"]?.["model_select"]?.selected_option?.value ?? "auto";
const model = modelValue === "auto" ? undefined : modelValue;
```

### Discord: セレクトメニュー追加

`showDiscordDeliverableSelect()` にモデル選択行を追加します。

Discord は ActionRow が最大5行。現在は完了形式 + 実行環境（任意）= 最大2行なので余裕があります。

```typescript
// discord-task.ts の showDiscordDeliverableSelect() 内に追加

const availableModels = await fetchAvailableModels();

const modelSelect = new StringSelectMenuBuilder()
  .setCustomId(`model_select:${message.id}`)
  .setPlaceholder("モデルを選択...")
  .addOptions([
    {
      label: "🤖 Auto",
      value: "auto",
      description: "デフォルト（Copilot が自動選択）",
      default: true,
    },
    ...availableModels.map((m) => ({
      label: m.displayName ?? m.name,
      value: m.name,
    })),
  ]);

components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modelSelect));
```

collector での値取得:

```typescript
let selectedModel: string | undefined = undefined;

// collect ハンドラ内
if (interaction.customId.startsWith("model_select:")) {
  const val = interaction.values[0];
  selectedModel = val === "auto" ? undefined : val;
}
```

`submitDiscordJob` のシグネチャに `model?: string` を追加し、ジョブ作成時に渡します。

---

## データフロー全体像

```
[Worker 起動時]
  copilot --help をパース
    → --model choices: "claude-sonnet-4.6", "gpt-5.4", ...
    → prisma.copilotModel.upsert() で DB に同期
       ※ enabled は手動管理（既存レコードは変更しない）

[Bot がドロップダウンを表示するとき]
  GET /api/models
    → prisma.copilotModel.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } })
    → [{ name: "claude-sonnet-4.6", ... }, ...]
  ドロップダウン: ["🤖 Auto", "claude-sonnet-4.6", ...]

[ユーザーがモデルを選択してジョブ投入]
  POST /api/jobs { ..., model: "claude-opus-4.6" | null }
    → Job.model = "claude-opus-4.6" (DB保存)
    → Worker: spawn("copilot", ["--autopilot", "--allow-all", "--model", "claude-opus-4.6", ...])
```

---

## 変更ファイル一覧

| ファイル                                    | 変更種別 | 内容                                                    |
| ------------------------------------------- | -------- | ------------------------------------------------------- |
| `prisma/schema.prisma`                      | 変更     | `CopilotModel` テーブル追加、`Job.model` フィールド追加 |
| `prisma/migrations/...`                     | 新規     | マイグレーション SQL                                    |
| `packages/core/src/types.ts`                | 変更     | `ExecuteOptions` に `model?: string` 追加               |
| `packages/worker/src/utils.ts`              | 変更     | `parseAvailableModels()` 追加                           |
| `packages/worker/src/index.ts`              | 変更     | 起動時に `syncCopilotModels()` 呼び出し                 |
| `packages/worker/src/executor.ts`           | 変更     | `--model` フラグを動的組み立て                          |
| `packages/local-agent/src/executor.ts`      | 変更     | 同上                                                    |
| `packages/api/src/routes/models.ts`         | 新規     | `GET /api/models` エンドポイント                        |
| `packages/api/src/index.ts`                 | 変更     | `modelsRouter` 追加                                     |
| `packages/bot/src/services/models.ts`       | 新規     | `fetchAvailableModels()` ヘルパー                       |
| `packages/bot/src/handlers/task.ts`         | 変更     | `TaskContext` / `submitJob` に `model` 追加             |
| `packages/bot/src/handlers/interactive.ts`  | 変更     | Slack モーダルにモデルドロップダウン追加                |
| `packages/bot/src/handlers/discord-task.ts` | 変更     | Discord UI にモデルセレクトメニュー追加                 |

---

## 注意点

- **Worker 未起動時**: `CopilotModel` テーブルが空でも API は `[]` を返す。Bot 側は「🤖 Auto」のみ表示してジョブ投入は正常に動作する。
- **enabled の扱い**: `upsert` の `update` 側では `enabled` を変更しない。Admin がいったん無効化したモデルを CLI アップデートで再有効化しないようにするため。
- **Local Agent**: `packages/local-agent/src/executor.ts` も Worker と同様に `model` オプションを受け取って `--model` フラグを付ける。
