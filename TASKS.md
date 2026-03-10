# CATAPULT タスクリスト

## Phase 1: プロジェクト基盤構築

- [ ] monorepo セットアップ (npm workspaces)
- [ ] TypeScript 設定 (tsconfig.base.json + 各パッケージ)
- [ ] ESLint v9 Flat Config
- [ ] Prettier 設定
- [ ] husky + lint-staged
- [ ] Docker Compose 構成 (postgres, redis, api, bot, worker, frontend)
- [ ] Dockerfile.api
- [ ] Dockerfile.worker (Node.js 22 + git + copilot-cli)
- [ ] Dockerfile.bot
- [ ] Dockerfile.frontend
- [ ] Prisma スキーマ定義
- [ ] Prisma マイグレーション
- [ ] GitHub Actions CI ワークフロー (typecheck + lint + format + test)
- [ ] .env.example
- [ ] README.md

## Phase 2: Copilot CLI Worker 実装

- [ ] CopilotExecutor クラス
  - [ ] `copilot --autopilot --allow-all --output json -p` でプロセス起動
  - [ ] NDJSON stdout を readline で行ごとにパース
  - [ ] EventEmitter でイベント配信
  - [ ] git clone (depth=1, 指定ブランチ)
  - [ ] ジョブ単位の分離ディレクトリ作成
  - [ ] MCP設定ファイル生成 (~/.copilot-cli/config.json)
  - [ ] インストラクション注入（ブランチ名にジョブ ID 含める指示）
  - [ ] プロセスのキャンセル (SIGTERM)
- [ ] NDJSON パーサー (output-parser.ts)
- [ ] PR URL 抽出 (stdout + done イベント)
- [ ] BullMQ Worker (job-processor.ts)
  - [ ] ジョブ取り出し → トークン取得 → Executor 実行
  - [ ] イベントを Redis Pub/Sub で配信
  - [ ] イベントを JobLog テーブルに保存 (thinking を除く)
  - [ ] 完了/失敗時にジョブステータス更新
  - [ ] 作業ディレクトリのクリーンアップ
  - [ ] concurrency: 3
- [ ] sandbox.ts (作業ディレクトリ管理)
- [ ] TokenVault (AES-256-GCM 暗号化)
- [ ] TokenRefresher (分散ロック付き自動リフレッシュ)
  - [ ] アクセストークン期限5分前に自動リフレッシュ
  - [ ] Redis 分散ロック (SET NX EX 30)
  - [ ] ダブルチェックパターン
  - [ ] ロック待ちポーリング (最大10秒)
  - [ ] 定期バッチ (cron 1時間ごと)

## Phase 3: Slack Bot 実装

- [ ] Slack Bolt セットアップ (Socket Mode)
- [ ] メンション検知 (app_mention イベント)
- [ ] 未連携ユーザー自動認証誘導
  - [ ] ephemeral メッセージで「GitHubで連携する」ボタン表示
  - [ ] pendingTask を Redis に一時保存
- [ ] OAuth コールバック処理
  - [ ] state 検証 (CSRF 防止)
  - [ ] トークン取得・暗号化保存
  - [ ] AccountLink 登録
  - [ ] 連携完了 DM 通知
- [ ] pendingTask 自動リトライ（「続行しますか？」ボタン）
- [ ] ワンライナーパターン (owner/repo の自動検出 + リポジトリ検証)
- [ ] インタラクティブパターン (external_select でリポジトリ選択)
- [ ] external_select データソース (options ハンドラー)
- [ ] ブランチ選択 (モーダル)
- [ ] 確認画面
- [ ] ボタン本人認証ミドルウェア (validateActionOwner)
- [ ] JobGuard チェック
- [ ] ジョブ投入 + キュー位置通知
- [ ] JobStreamRelay (Redis Pub/Sub → スレッド投稿)
- [ ] バッファリング (2秒間隔)
- [ ] イベントフォーマット (agent_step→💭, tool_call→🔧, shell→📟, file_edit→📝, error→❌, done→✅)

## Phase 4: Discord Bot 実装

- [ ] Discord.js セットアップ
- [ ] メンション検知 (messageCreate イベント)
- [ ] 未連携ユーザー認証誘導
  - [ ] DM にボタン表示
  - [ ] DM ブロック時のチャンネルフォールバック
  - [ ] pendingTask を Redis に一時保存
- [ ] OAuth コールバック処理 (Discord 版)
- [ ] StringSelectMenu リポジトリ選択 (最大25件)
- [ ] ブランチ選択
- [ ] 確認 → 実行
- [ ] MessageComponentCollector (タイムアウト: 2分)
- [ ] JobStreamRelay (Redis Pub/Sub → スレッド投稿)
- [ ] ストリーミング投稿 (2000文字チャンク分割)

## Phase 5: ReactAdmin 管理画面

- [ ] ReactAdmin v5 セットアップ
- [ ] dataProvider (REST API)
- [ ] authProvider (JWT + GitHub OAuth)
- [ ] ロールベース UI 分岐 (permissions で ADMIN/USER)
- [ ] 管理者モード: UserList
- [ ] 管理者モード: UserEdit (ロール変更)
- [ ] 管理者モード: JobList (全ユーザーのジョブ)
- [ ] 管理者モード: JobShow
- [ ] 管理者モード: McpToolConfig (グローバルツール管理)
- [ ] 管理者モード: SystemSettings
- [ ] 利用者モード: Dashboard
- [ ] 利用者モード: MyJobs (自分のジョブ一覧)
- [ ] 利用者モード: MyInstructions (インストラクション管理)
- [ ] 利用者モード: AccountLink (アカウント連携)
- [ ] 利用者モード: McpToolSettings (個人MCPツール設定)
- [ ] JobStatusBadge コンポーネント
- [ ] LogViewer コンポーネント
  - [ ] 既存ログの取得
  - [ ] 実行中ジョブの SSE リアルタイム購読
  - [ ] モノスペースフォントのターミナル風表示
  - [ ] LIVE バッジ + LinearProgress
- [ ] SSE エンドポイント (/api/jobs/:jobId/stream)

## Phase 6: MCPツール設定・インストラクション管理

- [ ] MCPツール CRUD API
  - [ ] 一覧取得 (グローバル + 個人)
  - [ ] 作成 (管理者: グローバル可、利用者: 個人のみ)
  - [ ] 更新
  - [ ] 削除
- [ ] グローバル/個人 MCPツール管理 (isGlobal フラグ)
- [ ] MCP設定ファイル Worker 注入 (~/.copilot-cli/config.json)
- [ ] インストラクション CRUD API
  - [ ] 一覧取得 (自分のみ)
  - [ ] 作成
  - [ ] 更新
  - [ ] 削除
- [ ] インストラクション → プロンプト結合 (isActive: true のみ)
- [ ] ReactAdmin 設定画面 (McpToolConfig, McpToolSettings, MyInstructions)

## Phase 7: セキュリティ強化・テスト・ドキュメント

### セキュリティ

- [ ] トークン暗号化 (AES-256-GCM + 環境変数マスターキー)
- [ ] 実行分離 (ジョブ単位の一時ディレクトリ + 完了後クリーンアップ)
- [ ] 危険コマンドブロックリスト (--deny-tool)
- [ ] レート制限 (JobGuard: maxConcurrentPerUser, maxConcurrentPerRepo, maxDailyPerUser, cooldown)
- [ ] 監査ログ (ジョブ作成・キャンセル・トークン操作・ロール変更)

### テスト

- [ ] 単体テスト: output-parser
- [ ] 単体テスト: token-vault (暗号化・復号化)
- [ ] 単体テスト: job-guard
- [ ] 単体テスト: streaming フォーマッター
- [ ] 統合テスト: POST /api/jobs
- [ ] 統合テスト: GET /api/jobs/:id/stream (SSE)
- [ ] 統合テスト: OAuth コールバック
- [ ] E2E テスト: ジョブ作成→実行→完了フロー

### ドキュメント

- [ ] README.md (セットアップガイド完成版)
- [ ] 環境変数一覧ドキュメント (docs/env-variables.md)
- [ ] API リファレンス (docs/api-reference.md)
