# CATAPULT - 着地期待値（DeliverableType）設計

## 概要

ユーザーが Slack / Discord からジョブを投入する際、**タスクの着地形式（何を成果物として望むか）** を選択できるようにする。  
現状は LLM がプロンプトから自律判断しているが、明示的に指定することで意図と実行結果のズレを防ぐ。

---

## 着地期待値の種類

| value         | ラベル            | 概要                                                             |
| ------------- | ----------------- | ---------------------------------------------------------------- |
| `pr`          | 🔀 PR 作成        | 変更を加え、プルリクエストを作成する（**現在のデフォルト動作**） |
| `report`      | 🔍 調査・報告     | コードを変更せず、調査結果をスレッドに報告する                   |
| `commit_only` | 📝 コミットのみ   | 変更をブランチにコミット・プッシュするが、PR は作成しない        |
| `review`      | 👁 コードレビュー | 既存コードをレビューして改善点・問題点をスレッドに報告する       |

---

## UX フロー変更

### 変更前（確認画面）

```
リポジトリ: owner/repo
ブランチ: main
タスク: バグを修正してください

[✅ 実行する]  [❌ キャンセル]
```

### 変更後（確認画面 → 着地期待値ボタンが確認を兼ねる）

```
リポジトリ: owner/repo
ブランチ: main
タスク: バグを修正してください

どの形式で完了しますか？
[🔀 PR 作成]  [🔍 調査・報告]  [📝 コミットのみ]  [👁 コードレビュー]
[❌ キャンセル]
```

着地期待値ボタンのタップ = 実行確認を兼ねる（「実行する」ボタンを廃止）。  
ワンタップ増えるが、意図の明示化と誤爆防止のトレードオフを許容する。

---

## フロー全体図

```
app_mention / Discord mention
    │
    ├─ テキストに owner/repo あり ─→ デフォルトブランチ取得
    │                                     └─→ 着地期待値選択（確認を兼ねる） ─→ submitJob
    │
    └─ テキストに owner/repo なし
          │
          ├─ [Slack] external_select でリポジトリ選択
          │    └─ モーダル: ブランチ選択 + 着地期待値選択（同一モーダルに追加）
          │                └─→ 確認メッセージ（確認ボタンは不要）→ submitJob
          │
          └─ [Discord] StringSelectMenu でリポジトリ選択
                └─ StringSelectMenu でブランチ選択
                      └─ StringSelectMenu で着地期待値選択（= 確認）
                            └─→ submitJob
```

---

## Slack 実装詳細

### 1. ワンライナーパス（リポジトリ指定あり）

`showConfirmation()` のボタンを変更する。

```typescript
// task.ts - showConfirmation() の blocks 変更

// 着地期待値ごとにボタンを生成するユーティリティ
function deliverableButtons(ctxBase64: string, slackUserId: string) {
  const types: Array<{ value: DeliverableType; label: string }> = [
    { value: "pr", label: "🔀 PR 作成" },
    { value: "report", label: "🔍 調査・報告" },
    { value: "commit_only", label: "📝 コミットのみ" },
    { value: "review", label: "👁 コードレビュー" },
  ];
  return types.map(({ value, label }) => ({
    type: "button",
    text: { type: "plain_text", text: label },
    action_id: "submit_job",
    // value = base64(ctx):deliverableType:slackUserId
    value: `${ctxBase64}:${value}:${slackUserId}`,
  }));
}
```

`action_id: "submit_job"` ハンドラーで `value` を `:` で分割し、最後の要素を `slackUserId`、末尾から2番目を `deliverableType` として取り出す。

### 2. インタラクティブパス（モーダル）

`interactive.ts` の `select_branch` モーダルに `static_select` ブロックを追加する。

```typescript
// interactive.ts - select_branch モーダルに追加するブロック
{
  type: "input",
  block_id: "deliverable_block",
  element: {
    type: "static_select",
    action_id: "deliverable_select",
    initial_option: {
      text: { type: "plain_text", text: "🔀 PR 作成" },
      value: "pr",
    },
    options: [
      { text: { type: "plain_text", text: "🔀 PR 作成" },         value: "pr" },
      { text: { type: "plain_text", text: "🔍 調査・報告" },       value: "report" },
      { text: { type: "plain_text", text: "📝 コミットのみ" },     value: "commit_only" },
      { text: { type: "plain_text", text: "👁 コードレビュー" },   value: "review" },
    ],
  },
  label: { type: "plain_text", text: "着地の期待値" },
},
```

モーダル送信ハンドラー (`select_branch` callback) で `deliverable_block.deliverable_select.selected_option.value` を取得し、`showConfirmation()` に渡す。

---

## Discord 実装詳細

ブランチ選択の `collector.on("collect")` の後に `showDiscordDeliverableSelect()` を呼ぶ。

```typescript
// discord-task.ts - 新規関数

async function showDiscordDeliverableSelect(
  user: User,
  task: string,
  repo: string,
  branch: string,
  message: Message,
  replyMsg: Message,
): Promise<void> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`deliverable_select:${message.id}`)
    .setPlaceholder("着地の期待値を選択...")
    .addOptions([
      { label: "🔀 PR 作成", value: "pr", description: "変更してプルリクエストを作成" },
      { label: "🔍 調査・報告", value: "report", description: "コードを変更せず調査・報告" },
      {
        label: "📝 コミットのみ",
        value: "commit_only",
        description: "ブランチにコミット。PR なし",
      },
      { label: "👁 コードレビュー", value: "review", description: "変更なし、レビュー結果を投稿" },
    ]);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await replyMsg.edit({
    content: `**${repo}** の \`${branch}\` で何を期待しますか？\n**タスク:** ${task}`,
    components: [row],
  });

  const collector = replyMsg.createMessageComponentCollector({
    filter: (i) => i.user.id === message.author.id,
    time: 2 * 60 * 1000,
    max: 1,
  });

  collector.on("collect", (interaction) => {
    void (async () => {
      if (!interaction.isStringSelectMenu()) return;
      await interaction.deferUpdate();
      const deliverableType = interaction.values[0] as DeliverableType;
      // 着地期待値選択 = 確認。そのまま submitDiscordJob へ
      await replyMsg.edit({
        content: `✅ ジョブを投入しました: \`${repo}\` - \`${branch}\` (${DELIVERABLE_LABELS[deliverableType]})`,
        components: [],
      });
      await submitDiscordJob(user, task, repo, branch, deliverableType, message);
    })();
  });

  // ... タイムアウト処理
}
```

---

## プロンプト変換（executor.ts / buildPrompt）

`ExecuteOptions` に `deliverableType` を追加し、タイプに応じたシステム指示を先頭に付与する。

```typescript
// executor.ts

export type DeliverableType = "pr" | "report" | "commit_only" | "review";

const DELIVERABLE_INSTRUCTIONS: Record<DeliverableType, string> = {
  pr: "",  // デフォルト動作、追加指示なし
  report: `## 出力形式: 調査・報告
コードの変更・コミット・プッシュ・PR作成は行わないでください。
以下のタスクについて調査し、結果をまとめて出力してください。

`,
  commit_only: `## 出力形式: コミットのみ
変更をブランチにコミット・プッシュしてください。
プルリクエストは作成しないでください。

`,
  review: `## 出力形式: コードレビュー
コードを変更・コミット・プッシュしないでください。
既存のコードをレビューし、改善点・問題点・良い点を整理して出力してください。

`,
};

private buildPrompt(options: ExecuteOptions): string {
  const jobShortId = options.jobId.slice(-8);
  const branchInstruction = `...`; // 既存

  const deliverableInstruction =
    DELIVERABLE_INSTRUCTIONS[options.deliverableType ?? "pr"];

  return [deliverableInstruction, branchInstruction, options.instructions ?? "", options.prompt]
    .filter(Boolean)
    .join("\n\n");
}
```

---

## データモデル変更

`Job` テーブルに `deliverableType` カラムを追加する。

```prisma
// prisma/schema.prisma

enum DeliverableType {
    PR
    REPORT
    COMMIT_ONLY
    REVIEW
}

model Job {
    // ...既存フィールド
    deliverableType DeliverableType @default(PR)
}
```

Admin UI やジョブ履歴でどの形式が選ばれたかを可視化できるようにするため DB に保存する。

---

## 型定義の共有

`packages/worker/src/executor.ts` に `DeliverableType` を定義し、bot パッケージからは `@prisma/client` の enum を使うか、または共通パッケージ化する。  
現状のモノレポ構成では **`packages/worker/src/executor.ts` に定義し、bot は文字列リテラル型で受け取る**のが最小コストで実装できる。

```typescript
// packages/bot/src/handlers/task.ts
export type DeliverableType = "pr" | "report" | "commit_only" | "review";

export const DELIVERABLE_LABELS: Record<DeliverableType, string> = {
  pr: "🔀 PR 作成",
  report: "🔍 調査・報告",
  commit_only: "📝 コミットのみ",
  review: "👁 コードレビュー",
};
```

Prisma の enum は大文字 (`PR`, `REPORT`, `COMMIT_ONLY`, `REVIEW`) で定義し、ジョブ保存時に変換する。

---

## TaskContext 変更

```typescript
// packages/bot/src/handlers/task.ts

export interface TaskContext {
  userId: string;
  repo: string;
  branch: string;
  task: string;
  deliverableType: DeliverableType; // ← 追加
  channelId: string;
  threadTs: string;
  slackUserId: string;
}
```

---

## API ルート変更（jobs.ts）

`POST /api/jobs` のリクエストボディに `deliverableType` を追加する。  
未指定時は `"pr"` をデフォルトとして受け入れる（後方互換性を維持）。

```typescript
const { repository, branch, prompt, deliverableType = "pr" } = req.body;
```

---

## 変更対象ファイル一覧

| ファイル                                    | 変更内容                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `prisma/schema.prisma`                      | `DeliverableType` enum 追加、`Job.deliverableType` フィールド追加          |
| `prisma/migrations/`                        | マイグレーション作成                                                       |
| `packages/worker/src/executor.ts`           | `DeliverableType` 型・定数追加、`buildPrompt()` に分岐追加                 |
| `packages/worker/src/job-processor.ts`      | `deliverableType` を executor に渡す                                       |
| `packages/bot/src/handlers/task.ts`         | `TaskContext` 更新、`showConfirmation()` ボタン変更、`submitJob()` 更新    |
| `packages/bot/src/handlers/interactive.ts`  | 着地期待値 `static_select` を branch モーダルに追加、submit ハンドラー更新 |
| `packages/bot/src/handlers/discord-task.ts` | `showDiscordDeliverableSelect()` 追加、フロー接続                          |
| `packages/api/src/routes/jobs.ts`           | `deliverableType` パラメータ受け取り・バリデーション追加                   |
| `packages/frontend/src/pages/admin/`        | ジョブ一覧に着地期待値列を表示（任意）                                     |

---

## 非対応ケース（スコープ外）

- **ワンライナーパス（テキストから自動判別）**: `"調査して"` などのキーワードからの自動判別は実装しない。ユーザーが明示的に選択する設計とする。将来の拡張として検討可能。
- **API 直接投入のデフォルト**: `deliverableType` 未指定は `"pr"` にフォールバックし、既存の動作を維持する。
