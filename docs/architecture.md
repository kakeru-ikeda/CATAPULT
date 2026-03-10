# CATAPULT - アーキテクチャ設計

## システム構成図

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Compose                           │
│                                                                 │
│  ┌──────────────┐    ┌──────────────────┐   ┌───────────────┐  │
│  │  Slack Bot    │    │   API Server     │   │  ReactAdmin   │  │
│  │  Discord Bot  │◄──►│   (Express/      │◄──►│  Frontend     │  │
│  │  (Bot Gateway)│    │    Fastify)      │   │  (Nginx)      │  │
│  └──────┬───────┘    └────────┬─────────┘   └───────────────┘  │
│         │                     │                                 │
│         │            ┌────────▼─────────┐                      │
│         │            │  Job Queue       │                      │
│         └───────────►│  (BullMQ/Redis)  │                      │
│                      └────────┬─────────┘                      │
│                               │                                 │
│                      ┌────────▼─────────┐                      │
│                      │  Worker Pool     │                      │
│                      │  ┌─────────────┐ │                      │
│                      │  │ Copilot CLI │ │   ┌───────────────┐  │
│                      │  │ Container   │ │   │  PostgreSQL   │  │
│                      │  │ (per job)   │ │   │  + Redis      │  │
│                      │  └─────────────┘ │   └───────────────┘  │
│                      └──────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

## コンポーネント説明

### API Server (Express/Fastify)

- REST API エンドポイントを提供
- GitHub OAuth コールバック処理
- SSE (Server-Sent Events) によるジョブログのストリーミング
- BullMQ キューへのジョブ投入
- JWT 認証 + RBAC ミドルウェア

### Bot Gateway (Slack Bot / Discord Bot)

- Slack Bolt SDK による Slack イベント処理
- Discord.js による Discord イベント処理
- ユーザーのメンションを受信してジョブをキューに投入
- Redis Pub/Sub を購読してリアルタイム進捗を投稿

### Job Queue (BullMQ / Redis)

- ジョブのキューイングと優先度管理
- 失敗時のリトライ
- ジョブ状態の管理

### Worker Pool (Copilot CLI Worker)

- BullMQ Worker でジョブを取り出して処理
- `copilot --autopilot --allow-all --output json -p` を実行
- 各ジョブは独立した一時ディレクトリで動作
- NDJSON 出力を行ごとにパースして Redis Pub/Sub に配信
- 処理完了後に一時ディレクトリをクリーンアップ

### ReactAdmin Frontend (Nginx)

- ReactAdmin v5 による管理画面
- 管理者モード / 利用者モードの切り替え
- SSE によるリアルタイムログ表示

### データストア

- **PostgreSQL**: ユーザー・ジョブ・ログ・MCPツール・インストラクションの永続化
- **Redis**: ジョブキュー・Pub/Sub・セッション・分散ロック・OAuth state

## ディレクトリ構成

```
copilot-dev-server/
├── docker-compose.yml
├── docker/
│   ├── Dockerfile.api
│   ├── Dockerfile.worker
│   ├── Dockerfile.frontend
│   └── Dockerfile.bot
├── packages/
│   ├── api/                    # Express/Fastify API Server
│   │   └── src/
│   │       ├── index.ts
│   │       ├── routes/
│   │       │   ├── auth.ts
│   │       │   ├── jobs.ts
│   │       │   ├── users.ts
│   │       │   ├── repos.ts
│   │       │   ├── mcp-tools.ts
│   │       │   └── instructions.ts
│   │       ├── services/
│   │       │   ├── copilot-executor.ts
│   │       │   ├── token-vault.ts
│   │       │   ├── token-refresher.ts
│   │       │   ├── job-queue.ts
│   │       │   ├── job-guard.ts
│   │       │   ├── github-repos.ts
│   │       │   ├── repo-cache.ts
│   │       │   └── streaming.ts
│   │       ├── models/
│   │       └── middleware/
│   │           ├── auth.ts
│   │           └── rbac.ts
│   ├── bot/                    # Slack/Discord Bot
│   │   └── src/
│   │       ├── index.ts
│   │       ├── auth.ts
│   │       ├── platforms/
│   │       │   ├── slack.ts
│   │       │   └── discord.ts
│   │       ├── handlers/
│   │       │   ├── mention.ts
│   │       │   ├── task.ts
│   │       │   ├── discord-mention.ts
│   │       │   ├── discord-task.ts
│   │       │   ├── options.ts
│   │       │   └── interactive.ts
│   │       ├── services/
│   │       │   ├── job-stream.ts
│   │       │   └── queue-status.ts
│   │       ├── middleware/
│   │       │   └── action-auth.ts
│   │       └── formatters/
│   │           ├── slack-blocks.ts
│   │           └── discord-embeds.ts
│   ├── worker/                 # Copilot CLI Worker
│   │   └── src/
│   │       ├── index.ts
│   │       ├── executor.ts
│   │       ├── job-processor.ts
│   │       ├── output-parser.ts
│   │       └── sandbox.ts
│   └── frontend/               # ReactAdmin 管理画面
│       └── src/
│           ├── App.tsx
│           ├── authProvider.ts
│           ├── dataProvider.ts
│           ├── pages/
│           │   ├── admin/
│           │   │   ├── UserList.tsx
│           │   │   ├── JobList.tsx
│           │   │   ├── McpToolConfig.tsx
│           │   │   └── SystemSettings.tsx
│           │   └── user/
│           │       ├── Dashboard.tsx
│           │       ├── MyJobs.tsx
│           │       ├── MyInstructions.tsx
│           │       ├── AccountLink.tsx
│           │       └── McpToolSettings.tsx
│           └── components/
│               ├── JobStatusBadge.tsx
│               └── LogViewer.tsx
├── prisma/
│   └── schema.prisma
├── package.json
└── tsconfig.base.json
```

## Docker Compose 構成

| サービス   | 説明                                     | ポート     |
| ---------- | ---------------------------------------- | ---------- |
| `postgres` | PostgreSQL 16                            | 5432       |
| `redis`    | Redis 7                                  | 6379       |
| `api`      | Express/Fastify API Server               | 3000       |
| `bot`      | Slack/Discord Bot Gateway                | 3001       |
| `worker`   | Copilot CLI Worker (replicas: 2)         | -          |
| `frontend` | ReactAdmin (Nginx)                       | 80 / 443   |

## Worker の Dockerfile

Worker コンテナには以下が含まれます:

```dockerfile
FROM node:22-slim

# git, その他ツールのインストール
RUN apt-get update && apt-get install -y git curl

# GitHub Copilot CLI のインストール
RUN npm install -g @github/copilot-cli

# アプリケーションのインストール
WORKDIR /app
COPY . .
RUN npm ci

CMD ["node", "dist/index.js"]
```

## データフロー

```
1. ユーザーが Slack/Discord でメンション
         ↓
2. Bot が認証確認（AccountLink テーブル参照）
         ↓
3. リポジトリ・ブランチ・タスク選択（インタラクティブ）
         ↓
4. JobGuard でレート制限チェック
         ↓
5. BullMQ キューにジョブ投入
         ↓
6. Worker がジョブを取り出してトークン取得
         ↓
7. git clone → Copilot CLI 実行
         ↓
8. NDJSON イベント → Redis Pub/Sub 配信 + DB 保存
         ↓
9. Bot が Pub/Sub 購読 → スレッドに進捗投稿
         ↓
10. 完了 → ジョブステータス更新 + 一時ディレクトリ削除
```
