# Slack Canvas 統合設計

## 概要

CATAPULT の Slack Bot レスポンスを、通常のメッセージから **Slack Canvas** に切り替える設計です。

### 背景・目的

| 問題                                               | 解決策                                            |
| -------------------------------------------------- | ------------------------------------------------- |
| Slack メッセージでマークダウンが正しく描画されない | Canvas はリッチなマークダウンをネイティブサポート |
| スレッドの長文レスポンスが読みづらい               | Canvas は常時更新される生きたドキュメント         |
| コードブロック・テーブル・リストが崩れる           | Canvas は GitHub Readme レベルの描画品質          |

---

## Canvas 活用方針

### 1つのスレッド = 1つの Canvas

```
Slack Thread
├── [メッセージ] ジョブ確認ボタン（インタラクティブ要素は従来通りメッセージ）
├── [メッセージ] "⚙️ 作業中... → 📄 Canvas で確認" + 停止ボタン
└── Canvas（1つのスレッドに対して1つ、継続的に更新）
     ├── ✅ ジョブ #1 の結果（完了後は保持）
     ├── ✅ ジョブ #2 の結果（完了後は保持）
     └── 🔄 ジョブ #3（現在実行中、進捗をリアルタイム更新）
```

- **Canvas は蓄積型**: 過去ジョブの結果は Canvas 上部に残り、最新ジョブが下部に追加される
- **進捗更新**: Canvas 全体を `canvases.edit` の `replace` オペレーションで置き換え（3秒スロットリング）
- **スレッド履歴**: セッション継続（リポジトリ引き継ぎ）は引き続き DB を使用。Canvas は表示レイヤー
- **インタラクティブ要素**（ボタン、モーダル）: Canvas は未サポートのため引き続きメッセージを使用

---

## Canvas のコンテンツ構造

### 実行中

```markdown
# 🤖 Copilot Catapult

## ✅ 前回のジョブタイトル（60文字以内）

**リポジトリ:** `owner/repo` @ `main`
**完了:** 2026/03/15 10:05:00

前回ジョブの結果サマリー（最大500文字）

🔀 [PR を開く](https://github.com/...)

---

## 🔄 現在のジョブタイトル

**リポジトリ:** `owner/repo` @ `feature/fix`
**開始:** 2026/03/15 10:30:00

⚙️ 作業中... (ステップ 5)
🔧 `npm test -- --run auth.test.ts`
💬 テストを修正しています
```

### 完了後

```markdown
# 🤖 Copilot Catapult

## ✅ 前回のジョブ

...

---

## ✅ 完了したジョブタイトル

**リポジトリ:** `owner/repo` @ `feature/fix`
**完了:** 2026/03/15 10:35:00

{Copilot による完全なマークダウン結果}

コードブロック、テーブル、リストなどが完全に描画

🔀 [PR を開く](https://github.com/...)
```

---

## 新規追加の Bot 権限（OAuth スコープ）

| スコープ         | 用途                                    | 優先度   |
| ---------------- | --------------------------------------- | -------- |
| `canvases:write` | Canvas の作成・編集                     | **必須** |
| `canvases:read`  | Canvas セクションの参照（将来の拡張用） | 推奨     |

> **注意**: `files:read` は不要。Canvas URL は `auth.test` API で取得したワークスペース URL から構築する。

### 更新後の全スコープ一覧

| スコープ               | 用途                                         |
| ---------------------- | -------------------------------------------- |
| `app_mentions:read`    | `app_mention` イベント購読                   |
| `chat:write`           | コントロールメッセージ（停止ボタン等）の送信 |
| `chat:write.customize` | コントロールメッセージの更新                 |
| `im:write`             | DM 送信（OAuth 完了通知）                    |
| `users:read`           | ユーザー情報取得                             |
| `channels:read`        | チャンネル情報取得                           |
| `canvases:write`       | **NEW**: Canvas の作成・編集                 |
| `canvases:read`        | **NEW**: Canvas セクション参照               |
| `connections:write`    | Socket Mode 用 App-Level Token               |

---

## データモデル変更

### 新規: `ThreadCanvas` モデル

```prisma
model ThreadCanvas {
  id        String   @id @default(cuid())
  platform  Platform
  channelId String
  threadId  String
  canvasId  String   @unique  // Slack が発行する canvas_id (F... 形式)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([platform, channelId, threadId])
}
```

1つの (platform, channelId, threadId) の組み合わせに対して 1つの Canvas を管理する。

---

## 実装コンポーネント

### `packages/bot/src/services/canvas-manager.ts`（新規）

| 関数                                                             | 役割                                        |
| ---------------------------------------------------------------- | ------------------------------------------- |
| `getOrCreateThreadCanvas(platform, channelId, threadId, client)` | DB から既存 Canvas を取得、なければ新規作成 |
| `updateThreadCanvas(canvasId, markdown, client)`                 | Canvas 全体をマークダウンで置き換え         |
| `buildCanvasMarkdown(prevJobs, current, progress)`               | 表示コンテンツを構築                        |
| `getCanvasUrl(canvasId, client)`                                 | `auth.test` から Canvas URL を組み立てる    |

### `packages/bot/src/services/job-stream.ts`（更新）

| 変更点                                      | 内容                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| コンストラクタ引数追加                      | `canvasId: string`, `canvasUrl: string`, `jobContext: JobCanvasContext` |
| `start()`                                   | Canvas を初期化、コントロールメッセージ（停止ボタン）を投稿             |
| `scheduleEdit()` → `scheduleCanvasUpdate()` | Canvas 更新をスロットリング                                             |
| `updateProgressMessage()`                   | コントロールメッセージのみ更新（コンテンツは Canvas）                   |
| `postSummaryMessage()` の削除               | サマリーは Canvas に描画                                                |

### `packages/bot/src/handlers/task.ts`（更新）

| 変更点           | 内容                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `submitJob()`    | `getOrCreateThreadCanvas()` を呼び出し、`canvasId`, `canvasUrl` を `JobStreamRelay` に渡す |
| キューメッセージ | Canvas URL を含める                                                                        |

---

## Slack Canvas API の利用方法

### Canvas 作成

```typescript
const result = await client.canvases.create({
  title: "Copilot Catapult",
  document_content: {
    type: "markdown",
    markdown: "# 🤖 Copilot Catapult\n\n作業ログを開始します...",
  },
});
const canvasId = result.canvas_id!; // "F0XXXXXXX"
```

### Canvas 全体を更新（replace 操作）

```typescript
await client.canvases.edit({
  canvas_id: canvasId,
  changes: [
    {
      operation: "replace",
      // section_id を省略 → Canvas 全体を置き換え
      document_content: { type: "markdown", markdown: newContent },
    },
  ],
});
```

### Canvas URL の取得

```typescript
const authInfo = await client.auth.test();
const workspaceUrl = authInfo.url; // "https://myworkspace.slack.com/"
const canvasUrl = `${workspaceUrl}docs/${canvasId}`;
```

---

## レート制限対策

- `canvases.edit` の Slack API レート制限: Tier 2（20 req/min）
- 3秒スロットリング（現行の `chat.update` と同じ間隔）で対応
- ジョブ完了・エラー・キャンセル時は即時更新（タイマーキャンセル後に実行）

---

## 段階的移行方針

1. **Phase 1（本設計）**: Slack のみ Canvas 対応。Discord は変更なし
2. **Phase 2（将来）**: Discord の Embed との統合（Discord には Canvas 相当の機能なし）
3. **Phase 3（将来）**: Canvas コンテンツのエクスポート / 検索機能

---

## 注意事項

- **Canvas はインタラクティブ要素未サポート**: ボタン（停止・確認）は引き続きメッセージで送信
- **Canvas の文字数制限**: 実装では 15,000 文字上限でトランケート（Slack Canvas の実際の上限は非公開だが実績ベース）
- **Canvas 作成タイミング**: `submitJob()` 時に作成（ユーザーがジョブを確認・送信したタイミング）
- **前ジョブ履歴**: 同一スレッドの直近 3 件まで Canvas に掲載
