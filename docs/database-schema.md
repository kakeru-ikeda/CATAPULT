# CATAPULT - データベース設計

## 概要

CATAPULT では PostgreSQL 16 を使用し、Prisma ORM でスキーマ管理・マイグレーションを行います。

## Prisma スキーマ

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ユーザーロール
enum Role {
  ADMIN
  USER
}

// 実行プラットフォーム
enum Platform {
  SLACK
  DISCORD
}

// ジョブステータス
enum JobStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

// ユーザー
model User {
  id                    String        @id @default(cuid())
  githubUsername        String        @unique
  githubAvatarUrl       String?
  githubToken           String        // AES-256-GCM 暗号化済み
  refreshToken          String?       // AES-256-GCM 暗号化済み
  tokenExpiresAt        DateTime?
  refreshTokenExpiresAt DateTime?
  role                  Role          @default(USER)
  createdAt             DateTime      @default(now())
  updatedAt             DateTime      @updatedAt

  accountLinks  AccountLink[]
  jobs          Job[]
  mcpTools      McpTool[]
  instructions  Instruction[]
}

// Slack/Discord アカウント連携
model AccountLink {
  id             String   @id @default(cuid())
  userId         String
  platform       Platform
  platformUserId String
  platformTeamId String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([platform, platformUserId])
}

// ジョブ
model Job {
  id            String    @id @default(cuid())
  userId        String
  repository    String    // "owner/repo" 形式
  branch        String
  prompt        String
  status        JobStatus @default(PENDING)
  output        String?   // 最終出力
  resultSummary String?   // 完了サマリー
  prUrl         String?   // 作成された PR の URL
  platform      Platform
  threadId      String?   // Slack/Discord のスレッド ID
  channelId     String?   // Slack/Discord のチャンネル ID
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  user    User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  logs    JobLog[]
}

// ジョブログ（イベントログ）
model JobLog {
  id        String   @id @default(cuid())
  jobId     String
  eventType String   // agent_step / tool_call / shell / file_edit / error / done
  content   String
  timestamp DateTime @default(now())

  job Job @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([jobId])
}

// MCPツール設定
model McpTool {
  id          String   @id @default(cuid())
  name        String
  description String?
  endpoint    String
  method      String   @default("POST")
  inputType   String?
  outputType  String?
  isGlobal    Boolean  @default(false) // true: 全ユーザーに適用
  ownerId     String?                  // null: グローバルツール
  enabled     Boolean  @default(true)
  config      Json?    // 追加設定
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  owner User? @relation(fields: [ownerId], references: [id], onDelete: Cascade)
}

// カスタムインストラクション
model Instruction {
  id        String   @id @default(cuid())
  userId    String
  name      String
  content   String
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

## モデル詳細

### User

ユーザー情報と GitHub トークンを管理します。

| カラム                  | 型        | 説明                                           |
| ----------------------- | --------- | ---------------------------------------------- |
| `id`                    | String    | CUID 形式の主キー                              |
| `githubUsername`        | String    | GitHub ユーザー名（ユニーク）                  |
| `githubAvatarUrl`       | String?   | GitHub アバター URL                            |
| `githubToken`           | String    | アクセストークン（AES-256-GCM 暗号化済み）     |
| `refreshToken`          | String?   | リフレッシュトークン（AES-256-GCM 暗号化済み） |
| `tokenExpiresAt`        | DateTime? | アクセストークン有効期限                       |
| `refreshTokenExpiresAt` | DateTime? | リフレッシュトークン有効期限                   |
| `role`                  | Role      | ADMIN / USER                                   |

### AccountLink

Slack/Discord アカウントと GitHub アカウントの紐付けを管理します。

| カラム           | 型       | 説明                                          |
| ---------------- | -------- | --------------------------------------------- |
| `id`             | String   | CUID 形式の主キー                             |
| `userId`         | String   | User の外部キー                               |
| `platform`       | Platform | SLACK / DISCORD                               |
| `platformUserId` | String   | Slack/Discord のユーザー ID                   |
| `platformTeamId` | String?  | Slack ワークスペース ID / Discord サーバー ID |

ユニーク制約: `[platform, platformUserId]`

### Job

Copilot CLI の実行ジョブを管理します。

| カラム          | 型        | 説明                                       |
| --------------- | --------- | ------------------------------------------ |
| `id`            | String    | CUID 形式の主キー                          |
| `userId`        | String    | User の外部キー                            |
| `repository`    | String    | "owner/repo" 形式のリポジトリ              |
| `branch`        | String    | 対象ブランチ名                             |
| `prompt`        | String    | タスクの指示内容                           |
| `status`        | JobStatus | PENDING/RUNNING/COMPLETED/FAILED/CANCELLED |
| `output`        | String?   | 最終出力テキスト                           |
| `resultSummary` | String?   | 完了時のサマリー                           |
| `prUrl`         | String?   | 作成された PR の URL                       |
| `platform`      | Platform  | タスクを投入したプラットフォーム           |
| `threadId`      | String?   | 進捗を投稿するスレッド ID                  |
| `channelId`     | String?   | チャンネル ID                              |
| `startedAt`     | DateTime? | 実行開始時刻                               |
| `completedAt`   | DateTime? | 完了時刻                                   |

### JobLog

ジョブの実行ログ（イベント）を永続化します。`thinking` イベントは保存しません。

| カラム      | 型       | 説明                                                      |
| ----------- | -------- | --------------------------------------------------------- |
| `id`        | String   | CUID 形式の主キー                                         |
| `jobId`     | String   | Job の外部キー                                            |
| `eventType` | String   | agent_step / tool_call / shell / file_edit / error / done |
| `content`   | String   | イベント内容（JSON 文字列）                               |
| `timestamp` | DateTime | イベント発生時刻                                          |

### McpTool

MCP (Model Context Protocol) ツールの設定を管理します。

| カラム        | 型      | 説明                                                   |
| ------------- | ------- | ------------------------------------------------------ |
| `id`          | String  | CUID 形式の主キー                                      |
| `name`        | String  | ツール名                                               |
| `description` | String? | ツールの説明                                           |
| `endpoint`    | String  | ツールのエンドポイント URL                             |
| `method`      | String  | HTTP メソッド（デフォルト: POST）                      |
| `inputType`   | String? | 入力スキーマ（JSON Schema 文字列）                     |
| `outputType`  | String? | 出力スキーマ（JSON Schema 文字列）                     |
| `isGlobal`    | Boolean | true: 全ユーザーに適用、false: 個人設定                |
| `ownerId`     | String? | 個人設定の場合のユーザー ID（グローバルの場合は null） |
| `enabled`     | Boolean | ツールの有効/無効                                      |
| `config`      | Json?   | 追加設定（JSON）                                       |

### Instruction

ユーザーのカスタムインストラクションを管理します。Copilot CLI 実行時にプロンプトに結合されます。

| カラム     | 型      | 説明                                   |
| ---------- | ------- | -------------------------------------- |
| `id`       | String  | CUID 形式の主キー                      |
| `userId`   | String  | User の外部キー                        |
| `name`     | String  | インストラクション名                   |
| `content`  | String  | インストラクション内容                 |
| `isActive` | Boolean | 有効/無効（無効は Copilot に渡さない） |

## インデックス設計

- `User.githubUsername`: ユニークインデックス（ログイン時の検索）
- `AccountLink.[platform, platformUserId]`: ユニーク複合インデックス（メンション時の照合）
- `JobLog.jobId`: インデックス（ジョブログの高速取得）

## セキュリティ設計

- `githubToken` と `refreshToken` は AES-256-GCM で暗号化して保存
- 暗号化キーは環境変数 `TOKEN_ENCRYPTION_KEY` で管理
- 詳細は [`docs/authentication.md`](./authentication.md) を参照
