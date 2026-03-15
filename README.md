# CATAPULT

Slack / Discord をインターフェースとして GitHub Copilot CLI を呼び出し、自律的にコーディング作業を行う開発サーバーです。

<div align="center">
  <img src="assets/banner-mini.svg" alt="CATAPULT Banner" />
</div>

## 概要

`@copilot` にメンションするだけで、タスクを自動実行・PR 作成まで行います。

- **チャット駆動**: Slack / Discord でリポジトリ・ブランチを選択してタスクを投入
- **リアルタイム進捗**: 実行ログをスレッドにストリーミング投稿
- **ユーザー認証**: GitHub App OAuth でユーザー自身のトークンを使用
- **管理画面**: ReactAdmin v5 によるジョブ管理・設定画面

## 技術スタック

| カテゴリ   | 技術                    |
| ---------- | ----------------------- |
| 言語       | TypeScript (strict)     |
| ランタイム | Node.js 22              |
| コンテナ   | Docker Compose          |
| DB         | PostgreSQL 16 + Prisma  |
| キュー     | Redis 7 + BullMQ        |
| Bot        | Slack Bolt / Discord.js |
| 管理画面   | ReactAdmin v5           |
| 認証       | GitHub App OAuth        |
| CLI        | GitHub Copilot CLI      |

## セットアップ

### 前提

- Node.js 22 以上
- Docker & Docker Compose
- GitHub App の作成（[docs/authentication.md](docs/authentication.md) 参照）

### ローカル開発

```bash
# 依存パッケージのインストール
npm install

# 環境変数の設定
cp .env.example .env
# .env を編集して各値を設定

# Docker でインフラ起動（PostgreSQL + Redis）
docker compose up postgres redis -d

# Prisma マイグレーション実行
npx prisma migrate dev

# Prisma クライアント生成
npx prisma generate
```

### コード品質チェック

```bash
# 型チェック
npm run typecheck

# Lint
npm run lint
npm run lint:fix

# フォーマット
npm run format
npm run format:check

# 全チェック
npm run check

# テスト
npm run test
```

### Docker で全サービス起動

```bash
# 環境変数設定
cp .env.example .env
# .env に POSTGRES_PASSWORD などを設定

# 全サービス起動
docker compose up -d

# ログ確認
docker compose logs -f
```

## ディレクトリ構成

```
CATAPULT/
├── packages/
│   ├── api/          # Express API サーバー
│   ├── bot/          # Slack / Discord Bot ゲートウェイ
│   ├── worker/       # Copilot CLI ワーカー
│   └── frontend/     # ReactAdmin 管理画面
├── prisma/
│   └── schema.prisma # データベーススキーマ
├── docker/
│   ├── Dockerfile.api
│   ├── Dockerfile.bot
│   ├── Dockerfile.worker
│   ├── Dockerfile.frontend
│   └── nginx.conf
├── docs/             # 設計ドキュメント
├── .github/
│   └── workflows/
│       └── ci.yml    # GitHub Actions CI
├── docker-compose.yml
├── tsconfig.base.json
├── eslint.config.mjs
└── .prettierrc
```

## ドキュメント

| ドキュメント                                       | 内容                      |
| -------------------------------------------------- | ------------------------- |
| [docs/overview.md](docs/overview.md)               | プロジェクト概要          |
| [docs/architecture.md](docs/architecture.md)       | アーキテクチャ設計        |
| [docs/database-schema.md](docs/database-schema.md) | データベース設計          |
| [docs/authentication.md](docs/authentication.md)   | 認証設計（OAuth フロー）  |
| [docs/streaming.md](docs/streaming.md)             | ストリーミング設計        |
| [docs/concurrency.md](docs/concurrency.md)         | 同時実行安全性設計        |
| [docs/tech-stack.md](docs/tech-stack.md)           | 技術スタック・Linter 設定 |

## ライセンス

MIT

hoge
