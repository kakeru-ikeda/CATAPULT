# CATAPULT - プロジェクト概要

## プロジェクト名

**CATAPULT**

## コンセプト

CATAPULT は、Slack / Discord をインターフェースとして GitHub Copilot CLI を呼び出し、自律的にコーディング作業を行う開発サーバーです。
Devin のような感覚で、チャットから自然言語でタスクを投げるだけで、自動的にコードの修正・PR 作成・テスト実行などを行うことができます。

## 主な特徴

### 1. チャット駆動の開発自動化

- Slack または Discord で `@copilot` にメンションするだけでタスクを起動
- リポジトリとブランチをインタラクティブに選択
- 実行状況をリアルタイムでスレッドに投稿

### 2. GitHub Copilot CLI の活用

内部的には以下のコマンドを実行します:

```bash
copilot --autopilot --allow-all --output json -p "<タスク内容>"
```

- `--autopilot`: 自律的に作業を進めるモード
- `--allow-all`: すべてのツール使用を許可
- `--output json`: NDJSON 形式で進捗イベントを取得
- GitHub Copilot CLI は 2026-02-25 に GA

### 3. ユーザー自身のトークンで実行

- 利用者自身の GitHub アカウントに紐づくトークンで CLI を実行
- Slack/Discord の ID と GitHub アカウントが密に紐づく
- PAT 不要（GitHub App の user-to-server トークンを使用）

### 4. 動的リポジトリ選択

- GitHub App 経由でインストール済みリポジトリを動的取得
- Slack の `external_select` / Discord の `StringSelectMenu` でインタラクティブに選択

### 5. ReactAdmin 管理画面

- **管理者モード**: ユーザー管理・全ジョブ監視・MCPツール設定・システム設定
- **利用者モード**: 自分のジョブ管理・個人インストラクション設定・アカウント連携・MCPツール設定

### 6. Docker 環境

- Docker Compose による完全なコンテナ化
- ワーカーは複数レプリカで並列処理

## 技術スタック概要

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
| CLI        | GitHub Copilot CLI (GA) |

詳細は [`docs/tech-stack.md`](./tech-stack.md) を参照してください。

## ドキュメント一覧

| ファイル                                                          | 内容                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| [`docs/architecture.md`](./architecture.md)                       | アーキテクチャ設計                                          |
| [`docs/database-schema.md`](./database-schema.md)                 | データベース設計                                            |
| [`docs/authentication.md`](./authentication.md)                   | 認証設計（OAuth フロー）                                    |
| [`docs/streaming.md`](./streaming.md)                             | ストリーミング設計                                          |
| [`docs/concurrency.md`](./concurrency.md)                         | 同時実行安全性設計                                          |
| [`docs/tech-stack.md`](./tech-stack.md)                           | 技術スタック・Linter/Formatter                              |
| [`docs/phase1-foundation.md`](./phase1-foundation.md)             | Phase 1: プロジェクト基盤構築                               |
| [`docs/phase2-copilot-worker.md`](./phase2-copilot-worker.md)     | Phase 2: Copilot CLI Worker 実装                            |
| [`docs/phase3-slack-bot.md`](./phase3-slack-bot.md)               | Phase 3: Slack Bot 実装                                     |
| [`docs/phase4-discord-bot.md`](./phase4-discord-bot.md)           | Phase 4: Discord Bot 実装                                   |
| [`docs/phase5-react-admin.md`](./phase5-react-admin.md)           | Phase 5: ReactAdmin 管理画面                                |
| [`docs/phase6-mcp-instructions.md`](./phase6-mcp-instructions.md) | Phase 6: MCPツール・インストラクション管理                  |
| [`docs/phase7-security-testing.md`](./phase7-security-testing.md) | Phase 7: セキュリティ強化・テスト                           |
| [`docs/skills.md`](./skills.md)                                   | Skills 機能設計                                             |
| [`docs/phase8-skills.md`](./phase8-skills.md)                     | Phase 8: Skills 機能実装                                    |
| [`docs/operations.md`](./operations.md)                           | 本番運用ガイド（導入・Bot設定・ローカルエージェント・保守） |
