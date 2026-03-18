# CATAPULT - セッション再設計: CLI Resume ベースの対話型実行

## ステータス: 設計確定（実装待ち）

> **⚠️ 後方互換性の考慮は不要**: 本プロジェクトは未リリースのため、破壊的変更を自由に行える。
> `parentJobId` や `conversationHistory` など旧セッション管理の仕組みは完全に削除し、Session ベースに一本化する。

---

## 1. 背景と動機

### 現行の問題

CATAPULT は現在「1メンション = 1ショット実行」のアーキテクチャで動作している。

```
ユーザー @copilot → Bot → BullMQ → Worker
  → git clone --depth=1 → copilot --autopilot -p "..." → 完了 → /tmp 全破棄
```

- `--autopilot` がハードコードされており、CLI は最後まで自律実行する
- ユーザーとの中間的なやり取り（質問・確認・方針相談）ができない
- 毎回 `git clone` + ワークスペース破棄のため、継続作業のコストが高い
- セッションは DB 上の `threadId + userId + repository` タプルで疑似管理しているだけで、CLI のコンテキスト（チェックポイント・ツール履歴）は保持されない

### 目標

1. **対話型実行**: ユーザーと Slack/Discord で適宜やり取りしながらタスクを進行できる
2. **CLI セッション継続**: `copilot --resume` を活用し、LLM のコンテキストを跨ぎターンで維持
3. **ワークスペース永続化**: クローン済みリポジトリを時限キャッシュで保持し、毎回のクローンを排除
4. **Autopilot はオプション**: 従来の自律実行モードも選択可能として残す

---

## 2. 現行アーキテクチャの詳細分析

### 2.1 `--autopilot` のハードコード箇所

| ファイル | 行 |
|---|---|
| `packages/worker/src/executor.ts` | L45: `"--autopilot"` |
| `packages/local-agent/src/executor.ts` | L33: `"--autopilot"` |

両方とも `spawn("copilot", [...])` の引数配列に直接記述。環境変数やオプションによる切り替え機構なし。

### 2.2 ワークスペースのライフサイクル

```
作成: executor.ts L21  → /tmp/copilot-jobs/{jobId}/workspace/
HOME: executor.ts L35  → /tmp/copilot-jobs/{jobId}/home/
破棄: job-processor.ts finally節 → cleanupWorkDir(jobId)
      sandbox.ts       → rm -rf /tmp/copilot-jobs/{jobId}/
```

- 各ジョブに一意のディレクトリが割り当てられる
- `HOME` を一時ディレクトリに設定するため、CLI のセッション状態 (`$HOME/.copilot/session-state/`) もジョブとともに破棄される
- `cleanupWorkDir()` は `finally` 節で必ず実行される

### 2.3 現行セッション管理

**DB 上のセッション表現**:
- `Job.threadId`: Slack の `thread_ts` または Discord のスレッド `channelId`
- `Job.parentJobId`: 同一スレッド内の直前ジョブへの参照
- `Session` テーブルは存在しない

**会話履歴の注入** (`job-processor.ts` L195-L215):
```
threadId + userId + repository → 最大10件の COMPLETED ジョブを検索
  → 各ジョブの prompt + resultSummary + prUrl をプロンプトに注入
```

CLI のチェックポイントやツール使用履歴は一切保持されない。LLM は毎回テキストベースの要約のみから文脈を復元している。

### 2.4 Worker のスケーリング

```yaml
# docker-compose.yml
worker:
  deploy:
    replicas: 2   # デフォルト 2 インスタンス
```

- BullMQ Worker: `concurrency: 3`（インスタンスあたり）
- 合計キャパシティ: 2 × 3 = 6 同時ジョブ
- 各 Worker は独立したコンテナで、`/tmp` は共有されない

---

## 3. CLI `--resume` の動作仕様

### 3.1 基本的な使い方

```bash
# セッション一覧から選択して再開（対話用）
copilot --resume

# 特定セッションIDを指定して再開
copilot --resume={sessionId}

# 直前のセッションを再開
copilot --continue

# 非対話モードで resume + 新しいプロンプト
copilot -p "続きの指示" --resume={sessionId} --allow-all
```

### 3.2 セッション状態の保存先

```
$HOME/.copilot/session-state/{sessionId}/
  ├── events.jsonl        # 全イベント履歴
  ├── workspace.yaml      # ワークスペース設定（cwd等）
  ├── checkpoints/
  │   └── index.md        # チェックポイント情報
  └── ...
```

### 3.3 非対話実行モデル

`--autopilot` を付けず、`-p`（プロンプト）+ `--no-ask-user` で起動した場合:

- CLI は **1 ターン実行後に exit code 0 で正常終了**する
- ツール実行（ファイル読み取り・編集等）を含む完全な 1 ターンを処理
- `result` イベントに `sessionId` が含まれる — これが `--resume` 用の識別子
- セッション状態が `$HOME/.copilot/session-state/{sessionId}/` に保存される

イベントフロー:
```
session.tools_updated → user.message → assistant.turn_start (turn 0)
  → tool.execution_* → assistant.turn_end (turn 0)
  → assistant.turn_start (turn 1) → assistant.message → assistant.turn_end (turn 1)
  → result { sessionId, exitCode: 0 }
```

**対話ループの実現方法**:
```bash
# 初回: 新規セッション作成
copilot -p "指示" --allow-all --output-format json --no-ask-user
# → result.sessionId を DB に保存

# 継続: セッション復元 + 新プロンプト
copilot -p "追加指示" --resume={sessionId} --allow-all --output-format json --no-ask-user
```

### 3.4 `--resume` によるセッション継続

`--resume={sessionId}` + `-p` で新しいプロンプトを与えた場合:

- 前回セッションの**完全な会話コンテキスト**（ツール使用歴含む）を復元する
- 新しいプロンプトに対して **1 ターン実行後に exit code 0 で正常終了**
- sessionId は変わらない（同一セッションとして維持）
- `events.jsonl` は追記される（1 ターンあたり約 14 行追加）
- ワークスペースのファイル変更は永続化されている

これにより、`conversationHistory` によるテキスト注入が不要になる（resume モード時）。

### 3.5 ワークスペースパスの扱い

CLI は初回実行時の**絶対パス**を `workspace.yaml` に記録し、`--resume` 時にはその絶対パスでツールを呼び出す。

- `--resume` 実行時の cwd が異なっていても CLI は起動する
- ただし、ツール呼び出し（`view`, `edit` 等）は**元の絶対パス**で実行される
- したがって、ワークスペースの実体が元のパスに存在する必要がある

**設計上の要件**: `/sessions/{sessionId}/workspace/` のようにパスを固定し、全 Worker が同一マウントポイントを使う。Docker Named Volume で全 Worker が `/sessions/` をマウントすれば、パスの一貫性が保証される。

### 3.6 セッション状態の構造と耐障害性

#### ファイル構成

```
$HOME/.copilot/
├── config.json                    # ユーザー設定（Worker 全体で共有可能）
├── logs/                          # プロセスログ（resume に不要）
└── session-state/{sessionId}/
    ├── events.jsonl               # ⭐ 会話コンテキストの本体
    ├── workspace.yaml             # cwd, git_root, branch（CLI が自動再生成可能）
    ├── checkpoints/               # チェックポイント
    ├── files/                     # セッション関連ファイル
    └── research/                  # リサーチ結果
```

- **永続化が必要なのは `session-state/{sessionId}/` ディレクトリのみ**
- `$HOME/.cache/copilot/pkg/` は CLI バイナリキャッシュ（全セッション共通、永続化不要）
- `config.json` はユーザー設定（Worker 全体で共有可能）

#### 耐障害性

| 障害 | CLI の挙動 | コンテキスト |
|------|-----------|-------------|
| `events.jsonl` 消失 | 正常起動。新規 `events.jsonl` を作成 | **喪失** — LLM がファイルを再読み込みして応答 |
| セッションディレクトリ消失 | 正常起動。同じ sessionId でディレクトリを再作成 | **喪失** — 上記と同様 |
| `workspace.yaml` のみ消失 | 正常起動。CLI が再生成 | **維持** — `events.jsonl` が健在なため |

CLI は sessionId 指定時に状態が存在しなくても**クラッシュしない**。同じ sessionId で状態を再作成するグレースフルデグレードが組み込まれている。DB 側の sessionId 管理が信頼の源となる。

### 3.7 ストレージサイズ

| 指標 | 値 |
|------|------|
| 初回セッション作成 | 約 30KB |
| 1 ターンあたりの増分 | 約 8KB |
| 10 ターン後 | 約 110KB |
| 100 ターン後 | 約 830KB |

管理可能なサイズ。GC ポリシーとディスク監視で十分に対応できる。

---

## 4. 新アーキテクチャ設計

### 4.1 概念図

```
                     ┌──────────────────────────────────────────────────┐
                     │          Shared Session Storage                  │
                     │  (Docker Named Volume: sessions_data)            │
                     │                                                  │
                     │  /sessions/{sessionId}/                          │
                     │    ├── workspace/   (git clone 済みリポジトリ)    │
                     │    ├── home/        (CLI セッション状態)          │
                     │    │   └── .copilot/session-state/{cliSessionId} │
                     │    └── meta.json    (最終アクセス時刻 etc.)       │
                     └─────────────┬────────────────────────────────────┘
                                   │  全 Worker でマウント
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
     ┌──────▼──────┐       ┌──────▼──────┐       ┌───────▼─────┐
     │  Worker #1  │       │  Worker #2  │       │  Worker #N  │
     │  (BullMQ)   │       │  (BullMQ)   │       │  (BullMQ)   │
     └─────────────┘       └─────────────┘       └─────────────┘
```

### 4.2 Session モデル（Prisma）

```prisma
enum SessionStatus {
  ACTIVE      // 使用中
  SUSPENDED   // 一時停止（ユーザー応答待ち）
  EXPIRED     // TTL 超過
  DESTROYED   // ディスク破棄済み
}

enum SessionMode {
  INTERACTIVE // 対話型（--resume ベース、ユーザーとやり取り）
  AUTOPILOT   // 自律型（--autopilot、従来動作）
}

model Session {
  id              String        @id @default(cuid())
  userId          String
  repository      String        // "owner/repo"
  branch          String
  threadId        String?       // Slack/Discord スレッドID
  channelId       String?       // Slack/Discord チャンネルID
  platform        Platform
  cliSessionId    String?       // copilot CLI の --resume 用セッションID
  volumePath      String        // /sessions/{id}
  mode            SessionMode   @default(INTERACTIVE)
  status          SessionStatus @default(ACTIVE)
  lastAccessedAt  DateTime      @default(now())
  expiresAt       DateTime?     // 時限キャッシュの有効期限
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  user    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  jobs    Job[]

  @@unique([userId, threadId, repository])
  @@index([status, lastAccessedAt])
}
```

`Job` モデルへの変更:
```prisma
model Job {
  // 既存フィールド ...
  sessionId   String?   // Session への参照（新規追加）
  session     Session?  @relation(fields: [sessionId], references: [id])
  // parentJobId は後方互換のため残すが、新規ジョブでは sessionId を優先使用
}
```

### 4.3 実行モードの分岐

#### AUTOPILOT モード（従来互換）

```
ユーザー: "@copilot [autopilot] テスト書いて"
  → copilot --autopilot --allow-all -p "..." → 完走 → 完了
```

従来と同じフロー。セッション管理は簡易（ワークスペースのみ永続化）。

#### INTERACTIVE モード（新規）

```
ユーザー: "@copilot テスト書いて"
  │
  ├─ Session 取得 or 新規作成
  │   → /sessions/{sessionId}/workspace/ にリポジトリ準備
  │
  ├─ Job 作成（INTERACTIVE モード）
  │   → Worker が copilot -p "テスト書いて" --allow-all --output-format json を実行
  │   → --autopilot なし、--resume={cliSessionId} あり（初回は省略）
  │
  ├─ CLI が 1 ターン実行 → 停止
  │   → done イベント: Bot がサマリーを Slack に表示
  │   → または未完了で終了: Bot が中間報告 + 「続行しますか？」を表示
  │
  └─ ユーザー: "カバレッジ 80% 以上にして"
      → 同一 Session → copilot -p "カバレッジ80%以上にして" --resume={cliSessionId}
      → CLIコンテキスト維持のまま継続実行
```

### 4.4 Executor の変更設計

```typescript
// 概念コード（packages/worker/src/executor.ts）

const baseArgs = [
  "--allow-all",
  "--output-format", "json",
  "--no-ask-user",           // stdin 不要（サーバー実行のため）
  ...modelArgs,
  ...denyArgs,
];

const modeArgs = session.mode === "AUTOPILOT"
  ? ["--autopilot"]
  : session.cliSessionId
    ? ["--resume", session.cliSessionId]
    : [];                    // 初回は新規セッション

const spawnArgs = [...baseArgs, ...modeArgs, "-p", prompt];

this.proc = spawn("copilot", spawnArgs, {
  cwd: session.volumePath + "/workspace",
  env: {
    ...process.env,
    GITHUB_TOKEN: options.githubToken,
    GH_TOKEN: options.githubToken,
    HOME: session.volumePath + "/home",
  },
});
```

### 4.5 共有ボリューム設計

#### 方式比較

| 方式 | メリット | デメリット |
|---|---|---|
| **A. Docker Named Volume** | 設定簡単、単一ホスト最適 | 複数ホスト不可 |
| **B. NFS 共有** | 複数ホスト対応 | NFS 運用コスト、レイテンシ |
| **C. セッションアフィニティ** | ボリューム共有不要 | Worker 障害時フェイルオーバー複雑 |
| **D. A + C ハイブリッド（推奨）** | 単一ホスト最適 + 効率的 | 複数ホスト時は B に移行必要 |

#### 推奨: D. Named Volume + セッションアフィニティ

```yaml
# docker-compose.yml
worker:
  volumes:
    - sessions_data:/sessions
volumes:
  sessions_data:
```

- 全 Worker コンテナが `/sessions` をマウント
- Redis に `session:{sessionId} → workerId` のアフィニティマッピング
- 同一セッションの後続ジョブは優先的に同じ Worker にルーティング
- Worker 障害時は別 Worker が同じボリュームパスでフェイルオーバー

#### 排他制御

同一セッションへの同時書き込みを防止:

```
Redis SET session:{sessionId}:lock {workerId} NX EX 300
  → 取得成功: 実行開始
  → 取得失敗: 他 Worker が実行中 → 待機 or エラー
```

### 4.6 ワークスペース永続化とガベージコレクション

#### 現行 → 新設計

| | 現行 | 新設計 |
|---|---|---|
| クローン | 毎回 `git clone --depth=1` | 初回のみ。以降は `git fetch + checkout` |
| 破棄タイミング | Job 完了時に即破棄 | Session TTL 超過時にGC |
| ストレージ | `/tmp/copilot-jobs/{jobId}/` | `/sessions/{sessionId}/` |

#### GC ポリシー

```
cron (毎時実行):
  SELECT * FROM Session
  WHERE status = 'ACTIVE'
    AND lastAccessedAt < NOW() - INTERVAL '{TTL}'

  → status = EXPIRED
  → rm -rf /sessions/{sessionId}/
  → status = DESTROYED
```

- デフォルト TTL: 24 時間（環境変数 `SESSION_TTL_HOURS` で設定可能）
- ディスク使用量監視: 閾値超過時は古いセッションから優先破棄
- Session ステータス遷移: `ACTIVE → SUSPENDED → EXPIRED → DESTROYED`

### 4.7 Bot 側の対話ループ

#### Slack の場合

```
[ユーザーメンション]
  ↓
Bot: Session 検索 (threadId + userId + repo)
  ├─ 既存 Session あり → "既存セッションを使用します"
  └─ なし → Session 新規作成
  ↓
[タスク選択 UI]
  → モード選択ボタン追加: [🔄 対話モード] [🚀 Autopilot]
  → デフォルトは対話モード
  ↓
[Job 実行 → 結果表示]
  ├─ 完了: サマリー表示
  └─ 対話モード: サマリー + 「このまま続けるには、このスレッドで @copilot に話しかけてください」
```

#### Discord の場合

同様のフロー。スレッド内の再メンションで `--resume` 継続。

### 4.8 CLI セッションID の取得

初回実行時に CLI が自動生成するセッションID を取得する方法:

1. **`result` イベントの `sessionId` フィールド（推奨）**: NDJSON ストリームの最終イベント `{"type":"result", "sessionId":"..."}` から取得。最も確実
2. **フォールバック**: `$HOME/.copilot/session-state/` の新規ディレクトリ名を走査

---

## 5. 変更影響範囲

### 5.1 ファイル変更一覧

| パッケージ | ファイル | 変更種別 | 内容 |
|---|---|---|---|
| `prisma` | `schema.prisma` | **変更** | `Session` モデル追加、`Job` に `sessionId` 追加 |
| `prisma` | 新マイグレーション | **追加** | Session テーブル作成 |
| `worker` | `executor.ts` | **大幅変更** | `--autopilot` 条件分岐、`--resume` 対応、永続パス |
| `worker` | `job-processor.ts` | **大幅変更** | Session ベースの実行フロー、cleanup → GC 化 |
| `worker` | `sandbox.ts` | **廃止 or 書き換え** | 即破棄 → Session ベースのライフサイクルに |
| `worker` | `session-manager.ts` | **新規** | Session CRUD・アフィニティ・ロック管理 |
| `worker` | `session-gc.ts` | **新規** | TTL ベースの GC cron |
| `worker` | `workspace-manager.ts` | **新規** | git clone / fetch / checkout の管理 |
| `bot` | `handlers/task.ts` | **変更** | モード選択 UI 追加 |
| `bot` | `handlers/mention.ts` | **変更** | 既存 Session の検出と再利用 |
| `bot` | `services/job-stream.ts` | **変更** | 中間完了・対話継続イベントのハンドリング |
| `core` | `types.ts` | **変更** | `ExecuteOptions` に `sessionMode`, `cliSessionId`, `volumePath` 追加 |
| `core` | `prompt-builder.ts` | **変更** | resume 時のプロンプト簡素化（履歴注入不要） |
| `local-agent` | `executor.ts` | **変更** | `--autopilot` 条件分岐、`--resume` 対応 |
| `docker` | `docker-compose.yml` | **変更** | `sessions_data` ボリューム追加 |

### 5.2 後方互換性

- **AUTOPILOT モード**: 従来と同じ動作を維持。既存のボタン UI からも選択可能
- **parentJobId**: 後方互換のため残す。新規ジョブでは `sessionId` を優先
- **conversationHistory**: AUTOPILOT モードでは従来通りプロンプト注入方式を使用
- DB マイグレーション: `Session` テーブル追加のみ、既存テーブルの破壊的変更なし

---

## 6. リスクと懸念事項

| リスク | 影響度 | 対策 |
|---|---|---|
| CLI セッション状態の肥大化 | 中 | GC + ディスク監視 |
| 同一セッションへの同時アクセス | 高 | Redis 分散ロック |
| Worker 障害時のセッション孤立 | 中 | ヘルスチェック + セッション引き継ぎ |
| `--resume` 時のパス不一致 | 中 | CLI は元の絶対パスを使用。全 Worker で `/sessions/` を共有マウント |
| セッション状態の破損 | 低 | CLI はグレースフルデグレード（クラッシュせず再作成） |
| ディスク容量の逼迫 | 中 | GC 閾値 + アラート |
| CLI バージョンアップでセッション形式変更 | 低 | セッション破棄 + 再作成のフォールバック |

---

## 7. 実装フェーズ

### Phase 1: 基盤
- Prisma `Session` モデル追加 + マイグレーション
- `session-manager.ts` 実装（CRUD・ロック）
- `workspace-manager.ts` 実装（永続化クローン・fetch）
- docker-compose ボリューム追加

### Phase 2: Executor 改修
- `--autopilot` 条件分岐
- `--resume` 対応
- CLI セッションID 取得ロジック

### Phase 3: Bot 改修
- モード選択 UI
- 対話ループのハンドリング
- Session 再利用ロジック

### Phase 4: GC・運用
- `session-gc.ts` cron 実装
- ディスク監視
- 管理画面（ReactAdmin）への Session 表示

### Phase 5: local-agent 対応
- `LocalCopilotExecutor` の `--resume` 対応

---

## 8. タスク管理

実装の進捗は [TASKS.md](../TASKS.md) の「セッション再設計: CLI Resume ベースの対話型実行」セクションで管理する。
各タスク完了時に TASKS.md のチェックボックスを更新すること。

---

## 9. 関連ドキュメント

- [session-strategy.md](session-strategy.md) - 現行の軽量セッション設計（本設計で置き換え予定）
- [architecture.md](architecture.md) - 全体アーキテクチャ
- [concurrency.md](concurrency.md) - 同時実行安全性
- [streaming.md](streaming.md) - ストリーミング設計
- [phase2-copilot-worker.md](phase2-copilot-worker.md) - Worker 設計
