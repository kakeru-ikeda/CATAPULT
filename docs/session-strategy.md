# CATAPULT - 軽量セッション設計書

## 概要

CATAPULT に「軽量セッション」戦略を導入し、Slack / Discord の同じスレッドに複数回メンションした場合、前回ジョブの成果（PR URL・サマリー）が次回プロンプトに自動注入される仕組みです。Copilot CLI はステートレスのままとし、**ユーザー体験の改善**と**工数最小化**を目的とします。

---

## 要件

- Slack / Discord の同じスレッドで追加メンションしたとき、「前回ジョブの成果や要約」が新しいジョブのプロンプトに自動先頭挿入される。
- スレッド内のジョブは `threadId`（Slack: `thread_ts`、Discord: スレッド自体の channelId）+ `repository` で紐付ける。
- セッション（文脈）は同一スレッド内の **最大10ターン** を時系列で注入する。
- 履歴検索は `threadId` + `userId` + `repository` で絞り込み、異なるリポジトリの履歴が混入しないようにする。
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
const previousContextSection =
  options.conversationHistory && options.conversationHistory.length > 0
    ? `## このスレッドのこれまでの会話履歴\n...履歴指示...\n\n${formatConversationHistory(options.conversationHistory)}`
    : "";
```

`conversationHistory` は `threadId` + `userId` + `repository` で絞り込んだ最大10件の過去ジョブから構築される。各ターンには `prompt`（ユーザー指示）、`resultSummary`（結果要約）、`prUrl`（PR URL）が含まれる。

プロンプト内では「今回の指示を最優先。履歴は文脈理解のための参考情報。過去の作業を繰り返さない」と明記し、LLM が過去の指示と今回の指示を混同しないようにする。

---

## プラットフォーム別スレッドID解決

### Slack

- `AppMentionEvent.thread_ts` が存在 → スレッド返信 → `thread_ts` をスレッドIDとして使用
- `thread_ts` が未定義 → 新規トップレベルメンション → `event.ts` をスレッドIDとして使用

`handleMention` が正規化済みの `threadTs` を `handleTask` に渡す。

### Discord

- Bot はジョブ毎に `startThread()` で進捗スレッドを作成する
- ユーザーが進捗スレッド内で再メンションした場合、`message.channelId`（スレッド自体の ID）をセッション識別子として使用する
- 親チャンネル ID ではなくスレッド固有の channelId を使うことで、チャンネル全体のジョブが混入しない
- 親チャンネルからの新規メンション → `message.id` で毎回独立セッション

---

## セキュリティ

- `previousContext` の検索は `userId` スコープで行うため、他ユーザーのサマリーが注入されることはない。

---

## 拡張余地

- 「チャットセッション型」（履歴全連結）への拡張は `Session` テーブル追加と履歴管理で対応可能。
- ReactAdmin から親子ジョブを辿る UI 追加も可能（`parentJobId` / `children` リレーション利用）。
