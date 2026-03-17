# CATAPULT

Slack / Discord から GitHub Copilot CLI を呼び出し、調査・実装・レビュー・PR 作成までを自律実行する開発サーバーです。

<div align="center">
  <img src="assets/banner-mini.svg" alt="CATAPULT Banner" />
</div>

## これ何？

CATAPULT は、チャット上で `@copilot` にメンションするだけで開発ジョブを流せる運用基盤です。

- Slack / Discord からジョブ投入
- GitHub App OAuth でユーザー本人の GitHub 権限を利用
- Worker が GitHub Copilot CLI を実行して進捗をストリーミング配信
- React Admin ベースの管理画面でジョブ・認証・MCP・Skills を管理
- ローカルエージェント経由で、各自の手元環境でもジョブ実行可能

## 現在のコードベースでできること

### 基本フロー

1. Slack / Discord でタスクを送る
2. リポジトリ・ブランチ・着地期待値を選ぶ
3. Worker または Local Agent が Copilot CLI を実行する
4. 進捗ログがスレッドにリアルタイム投稿される
5. 完了時に成果物の要約や PR URL を返す

### 対応機能

- **Slack / Discord Bot**: メンション起点のジョブ作成、確認 UI、停止操作
- **ストリーミング**: 実行ログを Slack スレッド / Discord スレッドへ段階的に投稿
- **GitHub App OAuth**: ユーザー単位で GitHub アカウント連携
- **管理画面**: ジョブ一覧、アカウント連携、MCP、Instructions、Skills、モデル設定
- **DeliverableType**: PR 作成だけでなく、調査レポートやレビュー系の着地にも対応
- **軽量セッション**: 同一スレッドの前回結果を次回ジョブへ引き継ぎ
- **Skills**: グローバル / 個人スキルを Worker に配備
- **モデル選択**: Copilot CLI の利用可能モデルを UI から選択
- **Local Agent**: clone なしでローカル開発環境上の既存 repo を使って実行
- **セキュリティ**: AES-256-GCM によるトークン暗号化、ジョブ単位の隔離、レート制限

## 技術スタック

| カテゴリ       | 技術                    |
| -------------- | ----------------------- |
| 言語           | TypeScript (strict)     |
| ランタイム     | Node.js 22              |
| パッケージ管理 | npm workspaces          |
| API            | Express 5               |
| Bot            | Slack Bolt / Discord.js |
| Worker         | BullMQ + Redis          |
| DB             | PostgreSQL 16 + Prisma  |
| 管理画面       | React Admin 5 + Vite    |
| 認証           | GitHub App OAuth / JWT  |
| CLI 実行       | GitHub Copilot CLI      |

詳細は [`docs/tech-stack.md`](docs/tech-stack.md) を参照してください。

## アーキテクチャざっくり

| コンポーネント         | 役割                                       |
| ---------------------- | ------------------------------------------ |
| `packages/api`         | OAuth、管理 API、SSE、Local Agent API      |
| `packages/bot`         | Slack / Discord からのジョブ投入と進捗投稿 |
| `packages/worker`      | Copilot CLI 実行、PR URL 抽出、ジョブ処理  |
| `packages/core`        | prompt builder / output parser / 共通型    |
| `packages/frontend`    | React Admin ベースの管理画面               |
| `packages/local-agent` | ローカル環境実行用 CLI / 常駐エージェント  |
| `prisma`               | Prisma スキーマ、seed、system skills       |

構成詳細は [`docs/architecture.md`](docs/architecture.md) をどうぞ。

## セットアップ

### 前提

- Node.js 22 以上
- npm
- Docker / Docker Compose
- PostgreSQL / Redis を使えるローカル実行環境
- GitHub App の設定

GitHub App や環境変数の詳細は、先に [`docs/authentication.md`](docs/authentication.md) と [`docs/env-variables.md`](docs/env-variables.md) を読むのがおすすめです。

### 最短のローカル開発セットアップ

```bash
npm install
cp .env.example .env

# PostgreSQL と Redis だけ起動
docker compose up -d postgres redis

# Prisma
npx prisma migrate deploy
npx prisma generate

# ひとまず品質チェック
npm run check
npm run test
```

`.env` の値は [`docs/env-variables.md`](docs/env-variables.md) を見ながら埋めてください。

### Docker Compose で全サービスを起動する

`docker-compose.yml` では外部ネットワーク `catapult-proxy` を参照します。初回のみ作成してください。

```bash
docker network create catapult-proxy
docker compose build
docker compose up -d
docker compose ps
```

本番相当の手順や Nginx / TLS / バックアップは [`docs/operations.md`](docs/operations.md) にまとめています。

## 開発コマンド

```bash
# 型チェック + Lint + format check
npm run check

# ESLint 自動修正
npm run lint:fix

# Prettier 整形
npm run format

# テスト
npm run test
```

## ディレクトリ構成

```text
CATAPULT/
├── assets/                  # バナー・アイコン
├── docker/                  # 各サービスの Dockerfile と nginx 設定
├── docs/                    # 設計書・運用ドキュメント
├── packages/
│   ├── api/                 # Express API サーバー
│   ├── bot/                 # Slack / Discord Bot
│   ├── core/                # 共通ロジック
│   ├── frontend/            # React Admin 管理画面
│   ├── local-agent/         # ローカル実行エージェント CLI
│   └── worker/              # Copilot CLI 実行ワーカー
├── prisma/
│   ├── schema.prisma        # DB スキーマ
│   ├── seed.ts              # 初期データ投入
│   └── system-skills/       # 配布用システムスキル
├── docker-compose.yml
├── TASKS.md                 # 実装タスク一覧
└── tsconfig.base.json
```

## ドキュメントガイド

README から迷子になりにくいように、用途別に docs を整理しました。

### まず読む

| ドキュメント                                     | 内容                               |
| ------------------------------------------------ | ---------------------------------- |
| [`docs/overview.md`](docs/overview.md)           | プロジェクト概要と狙い             |
| [`docs/tech-stack.md`](docs/tech-stack.md)       | 採用技術、Lint / Formatter 方針    |
| [`docs/env-variables.md`](docs/env-variables.md) | 環境変数一覧                       |
| [`docs/operations.md`](docs/operations.md)       | 本番運用、デプロイ、監視、障害対応 |
| [`docs/api-reference.md`](docs/api-reference.md) | API エンドポイント一覧             |

### コア設計

| ドキュメント                                         | 内容                            |
| ---------------------------------------------------- | ------------------------------- |
| [`docs/architecture.md`](docs/architecture.md)       | 全体アーキテクチャ              |
| [`docs/authentication.md`](docs/authentication.md)   | GitHub App OAuth とトークン管理 |
| [`docs/database-schema.md`](docs/database-schema.md) | Prisma ベースのデータモデル     |
| [`docs/streaming.md`](docs/streaming.md)             | 実行ログのストリーミング設計    |
| [`docs/concurrency.md`](docs/concurrency.md)         | 同時実行安全性とロック戦略      |

### 機能別ドキュメント

| ドキュメント                                                                     | 内容                              |
| -------------------------------------------------------------------------------- | --------------------------------- |
| [`docs/deliverable-type.md`](docs/deliverable-type.md)                           | PR / レポートなど着地期待値の設計 |
| [`docs/local-agent.md`](docs/local-agent.md)                                     | ローカルエージェント機能設計      |
| [`docs/model-selection.md`](docs/model-selection.md)                             | Copilot モデル選択機能            |
| [`docs/session-strategy.md`](docs/session-strategy.md)                           | 軽量セッション継続の仕組み        |
| [`docs/skills.md`](docs/skills.md)                                               | Skills 機能の全体設計             |
| [`docs/slack-canvas.md`](docs/slack-canvas.md)                                   | Slack Canvas 統合                 |
| [`docs/refactoring-core-shared-logic.md`](docs/refactoring-core-shared-logic.md) | Worker / Local Agent のコア共有化 |

### フェーズ別設計

| ドキュメント                                                         | 内容                               |
| -------------------------------------------------------------------- | ---------------------------------- |
| [`docs/phase1-foundation.md`](docs/phase1-foundation.md)             | プロジェクト基盤構築               |
| [`docs/phase2-copilot-worker.md`](docs/phase2-copilot-worker.md)     | Copilot CLI Worker 実装            |
| [`docs/phase3-slack-bot.md`](docs/phase3-slack-bot.md)               | Slack Bot 実装                     |
| [`docs/phase4-discord-bot.md`](docs/phase4-discord-bot.md)           | Discord Bot 実装                   |
| [`docs/phase5-react-admin.md`](docs/phase5-react-admin.md)           | 管理画面実装                       |
| [`docs/phase6-mcp-instructions.md`](docs/phase6-mcp-instructions.md) | MCP / Instructions 管理            |
| [`docs/phase7-security-testing.md`](docs/phase7-security-testing.md) | セキュリティ・テスト・ドキュメント |
| [`docs/phase8-skills.md`](docs/phase8-skills.md)                     | Skills 機能実装                    |

### パッケージ別の補助ドキュメント

| ドキュメント                                                       | 内容                        |
| ------------------------------------------------------------------ | --------------------------- |
| [`packages/local-agent/README.md`](packages/local-agent/README.md) | `catapult-agent` の利用手順 |
| [`TASKS.md`](TASKS.md)                                             | 実装済み / 未完了タスク一覧 |

## 補足メモ

- Discord 側の OAuth コールバック処理は `TASKS.md` 上では未完了です
- Local Agent を使う場合は GitHub Copilot CLI が各自のマシンに必要です
- システムスキルは `prisma/system-skills/` から Worker に配備されます

## ライセンス

MIT
