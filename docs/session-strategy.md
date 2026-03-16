# CATAPULT - 軽量セッション設計書

## 概要

CATAPULT に「軽量セッション」戦略を導入し、Slack / Discord の同じスレッドに複数回メンションした場合、前回ジョブの成果（PR URL・サマリー）が次回プロンプトに自動注入される仕組みです。Copilot CLI はステートレスのままとし、**ユーザー体験の改善**と**工数最小化**を目的とします。

---

## 要件

- Slack / Discord の同じスレッドで追加メンションしたとき、「前回ジョブの成果や要約」が新しいジョブのプロンプトに自動先頭挿入される。
- スレッド内の前回ジョブは `threadId`（Slack: `thread_ts`、Discord: ボットが作成したスレッドの channel ID）で紐付ける。
- セッション（文脈）は **1世代（直前のみ）** とする。多段連結や履歴全注入は行わない。
- 破壊的変更なし（DBスキーマ最小差分）。

---

## データフロー

```
ユーザー @メンション（スレッド内）
  │
  ├─ Bot: threadId で直前 COMPLETED ジョブを検索
  │        └─ 見つかれば parentJobId に参照を設定してジョブ作成
  │
  └─ Worker: parentJobId があれば parent.resultSummary を取得
              └─ previousContext として executor に渡す
                  └─ buildPrompt() で「## 前回の作業サマリー」として先頭挿入
```

---

## DBスキーマ差分

`prisma/schema.prisma` の Job モデルに以下を追加：

```prisma
model Job {
  // ... 既存フィールド
  parentJobId String? // 前回ジョブへの参照（軽量セッション）

  parent   Job?  @relation("JobSession", fields: [parentJobId], references: [id])
  children Job[] @relation("JobSession")
}
```

マイグレーション: `20260311104453_add_parent_job_session`

---

## プロンプト拡張

`packages/worker/src/executor.ts` の `buildPrompt()` にて：

```typescript
const previousContextSection = options.previousContext
  ? `## 前回の作業サマリー\n${options.previousContext}`
  : "";
const prompt = [branchInstruction, instructions ?? "", previousContextSection, userPrompt]
  .filter(Boolean)
  .join("\n\n");
```

`previousContext` には `resultSummary`（＋PR URL があれば付記）が格納されます。

なお、過去ターンの `prompt` にシステムが追記した「preferredBranchName 強制」セクションは、会話履歴へ再注入する前に除去します。これにより、前回ジョブで指定した作業ブランチ名が次ターン以降の継続ジョブを不必要に拘束しません。

---

## プラットフォーム別スレッドID解決

### Slack

- `AppMentionEvent.thread_ts` が存在 → スレッド返信 → `thread_ts` をスレッドIDとして使用
- `thread_ts` が未定義 → 新規トップレベルメンション → `event.ts` をスレッドIDとして使用

`handleMention` が正規化済みの `threadTs` を `handleTask` に渡す。

### Discord

- Bot はジョブ毎に `startThread()` でスレッドを作成し、`threadId = thread.id` として保存
- 次回メンション時に `message.channelId = thread.id` が一致 → セッション継続と判定

---

## セキュリティ

- `previousContext` の検索は `userId` スコープで行うため、他ユーザーのサマリーが注入されることはない。

---

## 拡張余地

- 「チャットセッション型」（履歴全連結）への拡張は `Session` テーブル追加と履歴管理で対応可能。
- ReactAdmin から親子ジョブを辿る UI 追加も可能（`parentJobId` / `children` リレーション利用）。
