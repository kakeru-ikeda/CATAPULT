# CATAPULT - ローカルエージェント（local-agent）機能設計

## 1. 概要・コンセプト

### ローカルモードの価値

現状の CATAPULT はサーバー上でリポジトリを `git clone` した空の環境で Copilot CLI を実行する。この方式では `.env`・`node_modules`・Docker などが存在しないため、コードを読んで PR を作成することはできても、テストの実行やビルドの確認、DB 接続を伴う動作確認といったタスクは原理的に不可能である。

ローカルモードは、**ユーザー自身の開発用 PC 上に常駐する軽量デーモン（local-agent）** がジョブを受け取り、既存の開発環境上で Copilot CLI を実行するモードである。ユーザーの `~/projects/myapp` には `.env`・`node_modules`・起動済み Docker コンテナが揃っており、エージェントはその状態をそのまま活用できる。「コードを書くだけでなく、実際に動かして確認しながら直す」というループが初めて実現できる。

### 利用シーン

| タスク例                       | サーバーモード  | ローカルモード |
| ------------------------------ | :-------------: | :------------: |
| コードを読んで PR 作成         |       ✅        |       ✅       |
| `npm test` を実行して確認      | ❌ 依存関係なし |       ✅       |
| `npm run dev` で動作確認       |   ❌ 環境なし   |       ✅       |
| DB に接続してデータ確認        |  ❌ .env なし   |       ✅       |
| Docker Compose で結合確認      |       ❌        |       ✅       |
| 「直して→確認→また直す」ループ |       ❌        |       ✅       |

---

## 2. アーキテクチャ

### 全体フロー図

```
① Slack/Discord でメンション
     ↓
② Bot: GET /api/agents/me → ONLINE のエージェント一覧を取得
     ↓
③ Slack モーダル: 実行モード選択（サーバー or ローカル）
     ┌ ONLINE エージェントが 0 台 → 「サーバー実行」のみ表示
     ├ ONLINE エージェントが 1 台 → 「サーバー実行 / ローカル実行（マシン名）」を表示
     └ ONLINE エージェントが 2 台以上 → 「サーバー実行 / どのマシンで実行するか」を選択
     ↓
④ Bot: DB に Job 作成 (executionMode=LOCAL, localAgentId=選択した agentId)
        ※BullMQ には積まない
     ↓
⑤ local-agent (対象 PC): ハートビート応答に自分宛ての pendingJobId が入る
     ↓
⑥ local-agent: POST /api/agents/jobs/claim → ジョブ情報取得
     ↓
⑦ local-agent: workspaceRoot 配下をスキャンしてリポジトリを解決
     ↓
⑧ ローカル開発環境で Copilot CLI 実行（.env・node_modules・Docker がそのまま使える）
     ↓
⑨ local-agent: イベントを POST /api/agents/jobs/:id/events に送信
     ↓
⑩ API: Redis Pub/Sub に publish
     ↓
⑪ Bot: スレッドにリアルタイム進捗を投稿（現状と同じ）
```

詳細な利用シーン別の比較は [セクション 1](#1-概要コンセプト) を参照。

---

## 3. DB スキーマ変更

### 新規テーブル: `LocalAgent`

```prisma
enum AgentStatus {
  ONLINE
  OFFLINE
}

enum ExecutionMode {
  SERVER
  LOCAL
}

model LocalAgent {
  id              String      @id @default(cuid())
  userId          String      // @unique を外して 1ユーザー複数エージェントに対応
  name            String      // マシン識別名（例: "MacBook Pro", "Desktop"）
  workspaceRoot   String      // "~/projects" など親フォルダ
  status          AgentStatus @default(OFFLINE)
  lastHeartbeatAt DateTime?
  agentToken      String      @unique
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  user User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  jobs Job[]
}
```

### 既存テーブルへの変更

```prisma
// Job テーブルへの追加
model Job {
  // ...既存フィールド
  executionMode  ExecutionMode  @default(SERVER)
  localAgentId   String?
  localAgent     LocalAgent?    @relation(fields: [localAgentId], references: [id])
}

// User テーブルへのリレーション追加
model User {
  // ...既存フィールド
  localAgents LocalAgent[]
}
```

---

## 4. API エンドポイント設計

`packages/api/src/routes/agents.ts`（新規）

| メソッド | パス                             | 認証              | 説明                                            |
| -------- | -------------------------------- | ----------------- | ----------------------------------------------- |
| POST     | /api/agents/register             | JWT（利用者）     | エージェント初回登録、agentToken を返す         |
| POST     | /api/agents/heartbeat            | Bearer agentToken | 生存確認・ONLINE 更新、pendingJobId を返す      |
| GET      | /api/agents/me                   | JWT（利用者）     | 自分のエージェント状態取得                      |
| GET      | /api/agents                      | JWT（管理者）     | 全エージェント状態一覧                          |
| POST     | /api/agents/jobs/claim           | Bearer agentToken | PENDING ジョブを 1 件取得し RUNNING に変更      |
| POST     | /api/agents/jobs/:jobId/events   | Bearer agentToken | イベント送信（Redis Pub/Sub 経由で Bot に配信） |
| POST     | /api/agents/jobs/:jobId/complete | Bearer agentToken | ジョブ完了通知                                  |
| POST     | /api/agents/jobs/:jobId/fallback | Bearer agentToken | サーバー実行へのフォールバック要求              |

### リクエスト/レスポンス型定義

#### `POST /api/agents/register`

```typescript
// Request
interface RegisterAgentRequest {
  name: string; // マシン識別名（例: "MacBook Pro"、省略時は OS hostname を使用）
  workspaceRoot: string; // 例: "~/projects"
}

// Response
interface RegisterAgentResponse {
  agentToken: string; // 例: "cat_agent_xxxxxxxxxxxx"
  agentId: string;
}
```

#### `POST /api/agents/heartbeat`

```typescript
// Request (Header: Authorization: Bearer <agentToken>)
// Body: なし

// Response
interface HeartbeatResponse {
  status: "ok";
  pendingJobId: string | null; // 実行待ちジョブがある場合に設定
}
```

#### `GET /api/agents/me`

```typescript
// Response（複数エージェントを配列で返す）
type AgentMeResponse = {
  agents: {
    id: string;
    name: string; // マシン識別名
    status: "ONLINE" | "OFFLINE";
    workspaceRoot: string;
    lastHeartbeatAt: string | null; // ISO 8601
  }[];
};
```

#### `GET /api/agents`（管理者のみ）

```typescript
// Response
interface AgentListResponse {
  agents: {
    id: string;
    userId: string;
    name: string; // マシン識別名
    userSlackId?: string;
    userDiscordId?: string;
    status: "ONLINE" | "OFFLINE";
    workspaceRoot: string;
    lastHeartbeatAt: string | null;
  }[];
}
```

#### `POST /api/agents/jobs/claim`

```typescript
// Request (Header: Authorization: Bearer <agentToken>)
// Body: なし

// Response
interface ClaimJobResponse {
  jobId: string;
  repository: string; // 例: "owner/repo"
  branch: string;
  prompt: string;
  githubToken: string; // 一時トークン（実行用）
}
```

#### `POST /api/agents/jobs/:jobId/events`

```typescript
// Request
interface JobEventsRequest {
  events: {
    type: string; // "message" | "tool_call" | "error" など
    data: unknown;
    timestamp: string; // ISO 8601
  }[];
}

// Response
interface JobEventsResponse {
  received: number; // 受け取ったイベント数
}
```

#### `POST /api/agents/jobs/:jobId/complete`

```typescript
// Request
interface JobCompleteRequest {
  status: "COMPLETED" | "FAILED";
  error?: string; // 失敗時のエラーメッセージ
}

// Response
interface JobCompleteResponse {
  ok: true;
}
```

#### `POST /api/agents/jobs/:jobId/fallback`

```typescript
// Request
interface JobFallbackRequest {
  reason: string; // フォールバック理由（例: "repository not found locally"）
}

// Response
interface JobFallbackResponse {
  ok: true;
  // サーバーモードでジョブを再実行する
}
```

---

## 5. local-agent パッケージ設計

### パッケージ構成

```
packages/local-agent/
├── src/
│   ├── index.ts              # CLI エントリーポイント（init / start コマンド）
│   ├── agent.ts              # メインループ（ハートビート＋ジョブポーリング）
│   ├── executor.ts           # CopilotExecutor のローカル版（git clone しない）
│   ├── workspace-resolver.ts # workspaceRoot 配下のリポジトリ動的解決
│   ├── event-reporter.ts     # イベントをバッファリングして API に送信
│   └── config.ts             # ~/.catapult/config.json の読み書き
├── package.json
└── tsconfig.json
```

### 設定ファイル仕様 `~/.catapult/config.json`

`agentToken` は PC ごとに異なるため、マシンごとに独立した設定ファイルを持つ。

```json
{
  "apiUrl": "https://your-catapult-server.com",
  "agentToken": "cat_agent_xxxxxxxxxxxx",
  "name": "MacBook Pro",
  "workspaceRoot": "~/projects"
}
```

### npm 公開仕様

- パッケージ名: `catapult-agent`
- `bin` フィールドに `catapult-agent` を登録
- `index.ts` の先頭に `#!/usr/bin/env node` shebang 必須（TypeScript コンパイル後も `dist/index.js` に shebang が保持されるよう、ビルドスクリプトで `chmod +x dist/index.js` を実行するか、esbuild の `banner` オプション等で出力先に付与すること）
- `files` フィールドに `dist/` のみ含める
- 依存は最小限（`@prisma/client`・`bullmq`・`ioredis` は含めない。API サーバーと HTTP のみで通信）
- `npx catapult-agent init` / `npx catapult-agent start` で動作すること

```json
{
  "name": "catapult-agent",
  "version": "0.1.0",
  "description": "Local agent daemon for CATAPULT",
  "bin": {
    "catapult-agent": "./dist/index.js"
  },
  "files": ["dist/"],
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "commander": "^12.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### `agent.ts` メインループ仕様

- 30 秒ごとにハートビートを送信（OFFLINE 判定タイムアウトは 90 秒 = ハートビート間隔の 3 倍）
- ハートビートレスポンスに `pendingJobId` が含まれる場合はジョブ実行フローへ
- ジョブ実行中もハートビートは継続（別非同期処理）
- SIGTERM / SIGINT でグレースフルシャットダウン

```typescript
// メインループの概要
async function startMainLoop(config: Config): Promise<void> {
  const HEARTBEAT_INTERVAL_MS = 30_000;

  let currentJobId: string | null = null;

  const heartbeatTimer = setInterval(async () => {
    const res = await sendHeartbeat(config);
    if (res.pendingJobId && !currentJobId) {
      currentJobId = res.pendingJobId;
      runJob(config, res.pendingJobId).finally(() => {
        currentJobId = null;
      });
    }
  }, HEARTBEAT_INTERVAL_MS);

  process.on("SIGTERM", () => shutdown(heartbeatTimer));
  process.on("SIGINT", () => shutdown(heartbeatTimer));
}
```

### `workspace-resolver.ts` 仕様（重要）

フォルダ名ではなく `.git/config` の remote URL で判定する再帰スキャン：

```typescript
// スキャン戦略
// 1. workspaceRoot 配下を再帰的にスキャン（maxDepth=4、暫定値：要検証）
// 2. .git/config を直接読んで remote "origin" の URL を取得（git コマンド不要）
// 3. "github.com/owner/repo" "github.com:owner/repo" "github.com/owner/repo.git" の
//    3 パターンで照合
// 4. .git が見つかったディレクトリより深くは掘らない（サブモジュール考慮）
// 5. node_modules/.git/dist/build/.cache/.npm/.yarn/vendor/__pycache__/.venv は除外
// 6. ドットから始まる隠しフォルダは除外
// 7. ローカルに見つからない場合は null を返す
//    → agent.ts が fallback API を呼ぶ
```

照合パターン:

```typescript
const matchPatterns = [
  `github.com/${repository}`,
  `github.com:${repository}`,
  `github.com/${repository}.git`,
];
```

### `event-reporter.ts` 仕様

- イベントを 2 秒間バッファリングしてまとめて POST（毎イベントごとに HTTP を叩かない。2 秒は「Slack の投稿更新に体感できる遅延」と「HTTP コスト削減」のバランスによる固定値）
- `flush()` メソッドで即時送信も可能（完了・エラー時に使用）

```typescript
class EventReporter {
  private buffer: JobEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  report(event: JobEvent): void {
    this.buffer.push(event);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 2_000);
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    await postEvents(this.jobId, events);
  }
}
```

### `executor.ts`（ローカル版）とサーバー版の差分

| 項目           | サーバー版（`packages/worker/src/executor.ts`） | ローカル版                                      |
| -------------- | ----------------------------------------------- | ----------------------------------------------- |
| git clone      | あり（`/tmp/copilot-jobs/{jobId}/workspace`）   | **なし**                                        |
| workDir        | `/tmp/...` の一時ディレクトリ                   | `workspace-resolver` で解決したパス             |
| HOME           | `/tmp/copilot-jobs/{jobId}/home`                | ローカルユーザーの HOME をそのまま使用          |
| 環境変数       | サーバーの `process.env`                        | **ローカルの `process.env` をそのまま引き継ぎ** |
| クリーンアップ | 実行後に一時ディレクトリ削除                    | **なし（ユーザーのディレクトリは触らない）**    |

### `init` コマンド仕様

```
$ npx catapult-agent init

対話形式で以下を入力:
1. CATAPULT サーバーの URL
2. このマシンの名前（デフォルト: OS の hostname）
   例: "MacBook Pro"、"Desktop-Ubuntu" など
   ※ Slack/Discord のエージェント選択 UI でこの名前が表示される
3. ローカルのワークスペース親フォルダ（例: ~/projects）
   ※この配下のすべての git リポジトリが対象になる

処理:
- POST /api/agents/register を呼び出して agentToken を取得
  （同じユーザーが複数回 init しても別エージェントとして登録される）
- ~/.catapult/config.json に保存
```

---

## 6. Bot フローへの組み込み

### インタラクションフローの変更

**現在のフロー:**

```
メンション → リポジトリ選択 → ブランチ選択 + 着地期待値選択 → submitJob
```

**変更後のフロー:**

```
メンション → リポジトリ選択 → 実行モード選択（ONLINE エージェントが 1 台以上の時のみ表示）
                                    → ブランチ選択 + 着地期待値選択 → submitJob
```

### 実行モード選択 UI の仕様

- `GET /api/agents/me` で ONLINE エージェント数に応じて以下のように分岐する
- **0 台**: 選択肢を表示しない（サーバー実行のみ。UI 変更なし）
- **1 台**: 「サーバー実行 / ローカル実行（マシン名）」の 2 択を表示
- **2 台以上**: 「サーバー実行 / ローカル実行（マシンを選択）」を表示し、ローカル選択後にどのエージェントか選択させる
- ローカル実行選択時、「リポジトリが見つからない場合は自動でサーバー実行に切り替わります」と表示

Slack モーダルに追加するブロック（`interactive.ts`）:

```
【ONLINE 1 台の場合】
実行環境
○ 🖥️ サーバー実行（デフォルト）
○ 💻 ローカル実行（MacBook Pro）
  （見つからない場合は自動でサーバー実行に切り替わります）

【ONLINE 2 台以上の場合】
実行環境
○ 🖥️ サーバー実行（デフォルト）
○ 💻 ローカル実行
  実行マシン: [MacBook Pro ▼]  ← static_select で選択
  （見つからない場合は自動でサーバー実行に切り替わります）
```

Discord の場合は `StringSelectMenu` で同様に実装。サーバーを選択肢の先頭に置き、以降に各 ONLINE エージェントを並べる（最大 24 台 + サーバーで合計 25 件以内）。

### `submitJob` の分岐（`task.ts`）

- `executionMode === "LOCAL"` の場合: DB に Job 作成のみ、**BullMQ には積まない**
- `executionMode === "SERVER"` の場合: 現状通り BullMQ に積む

```typescript
// task.ts 変更イメージ
if (executionMode === "LOCAL") {
  // BullMQ には積まず DB にのみ保存
  // localAgentId = ユーザーが選択したエージェントの ID
  await prisma.job.create({
    data: { ...jobData, executionMode: "LOCAL", localAgentId },
  });
} else {
  // 現状通り BullMQ に積む
  await jobQueue.add("job", jobData);
}
```

> **注意**: ハートビートの `pendingJobId` は `localAgentId` が自分の `agentId` と一致するジョブのみ返す。
> 複数台が同時に起動していても、それぞれ別のジョブを受け取る。

---

## 7. 管理画面への統合

### 管理者: UserList の変更

`packages/frontend/src/pages/admin/UserList.tsx` に `LocalAgentStatusField` コンポーネントを追加:

- 登録されているすべてのエージェントをリスト表示
- 各エージェントについて 🟢 オンライン / 🔴 オフライン を表示
- 未登録の場合は「未登録」と表示

```tsx
const LocalAgentStatusField = ({ record }: { record: User }) => {
  const agents = record.localAgents ?? [];
  if (agents.length === 0) return <span>未登録</span>;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {agents.map((agent) => (
        <li key={agent.id}>
          {agent.status === "ONLINE" ? "🟢" : "🔴"} {agent.name} ({agent.workspaceRoot})
        </li>
      ))}
    </ul>
  );
};
```

### 利用者: Dashboard の変更

`packages/frontend/src/pages/user/Dashboard.tsx` にエージェント状態カードを追加:

- 登録されているすべてのエージェントを一覧表示（マシン名・ステータス・workspaceRoot・最終ハートビート時刻）
- ONLINE のエージェントが 1 台以上あればローカル実行が利用可能な旨を表示
- 未登録または全台 OFFLINE の場合はセットアップ導線を表示

```tsx
const AgentStatusCard = () => {
  // GET /api/agents/me を呼び出し agents 配列を取得
  // agents.length === 0 → "npx catapult-agent init" の手順を案内
  // agents.length > 0 → 各エージェントのステータスをカード表示
};
```

---

## 8. 実装ファイル一覧

| ファイル                                         | 種別 | 内容                                                                                              |
| ------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                           | 変更 | `LocalAgent` モデル追加、`ExecutionMode` enum 追加、`Job` に `executionMode`・`localAgentId` 追加 |
| `packages/api/src/routes/agents.ts`              | 新規 | エージェント用 API エンドポイント群                                                               |
| `packages/api/src/index.ts`                      | 変更 | `agentsRouter` の登録追加                                                                         |
| `packages/bot/src/handlers/interactive.ts`       | 変更 | リポジトリ選択後に実行モード選択を追加                                                            |
| `packages/bot/src/handlers/task.ts`              | 変更 | `submitJob` に LOCAL モード分岐を追加                                                             |
| `packages/bot/src/handlers/discord-task.ts`      | 変更 | Discord 版の実行モード選択を追加                                                                  |
| `packages/frontend/src/pages/admin/UserList.tsx` | 変更 | `LocalAgentStatusField` コンポーネント追加                                                        |
| `packages/frontend/src/pages/user/Dashboard.tsx` | 変更 | エージェント状態カード追加                                                                        |
| `packages/local-agent/src/index.ts`              | 新規 | CLI エントリーポイント（shebang 付き）                                                            |
| `packages/local-agent/src/agent.ts`              | 新規 | ハートビート＋ポーリングメインループ                                                              |
| `packages/local-agent/src/executor.ts`           | 新規 | clone なし CopilotExecutor                                                                        |
| `packages/local-agent/src/workspace-resolver.ts` | 新規 | git remote URL による動的リポジトリ解決                                                           |
| `packages/local-agent/src/event-reporter.ts`     | 新規 | イベントバッファリング送信                                                                        |
| `packages/local-agent/src/config.ts`             | 新規 | `~/.catapult/config.json` の読み書き                                                              |
| `packages/local-agent/package.json`              | 新規 | npm 公開設定（`bin`・`files` フィールド含む）                                                     |
| `packages/local-agent/tsconfig.json`             | 新規 | TypeScript 設定                                                                                   |

---

## 9. 未解決の検討事項（TODO）

- ローカルエージェントへの `agentToken` の安全な受け渡し方法（初回登録フロー詳細）
- ハートビート途絶時の OFFLINE 判定タイムアウト値（暫定: 最終ハートビートから 90 秒）
- ローカル実行時のジョブキャンセル方法（現状の BullMQ 経由のキャンセルが使えない）
- `maxDepth=4` の妥当性（深すぎるとスキャンが遅い、浅すぎると見つからない。現在は仕様内でも暫定値として記載）
- 同一ユーザーが登録したエージェント台数の上限（スパム防止のため API 側で上限を設けることを検討）
