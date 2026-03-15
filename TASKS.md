# CATAPULT タスクリスト

## Phase 1: プロジェクト基盤構築

- [x] monorepo セットアップ (npm workspaces)
- [x] TypeScript 設定 (tsconfig.base.json + 各パッケージ)
- [x] ESLint v9 Flat Config
- [x] Prettier 設定
- [x] husky + lint-staged
- [x] Docker Compose 構成 (postgres, redis, api, bot, worker, frontend)
- [x] Dockerfile.api
- [x] Dockerfile.worker (Node.js 22 + git + copilot-cli)
- [x] Dockerfile.bot
- [x] Dockerfile.frontend
- [x] Prisma スキーマ定義
- [x] Prisma マイグレーション
- [x] GitHub Actions CI ワークフロー (typecheck + lint + format + test)
- [x] .env.example
- [x] README.md

## Phase 2: Copilot CLI Worker 実装

- [x] CopilotExecutor クラス
  - [x] `copilot --autopilot --allow-all --output json -p` でプロセス起動
  - [x] NDJSON stdout を readline で行ごとにパース
  - [x] EventEmitter でイベント配信
  - [x] git clone (depth=1, 指定ブランチ)
  - [x] ジョブ単位の分離ディレクトリ作成
  - [x] MCP設定ファイル生成 (~/.copilot-cli/config.json)
  - [x] インストラクション注入（ブランチ名にジョブ ID 含める指示）
  - [x] プロセスのキャンセル (SIGTERM)
- [x] NDJSON パーサー (output-parser.ts)
- [x] PR URL 抽出 (stdout + done イベント)
- [x] BullMQ Worker (job-processor.ts)
  - [x] ジョブ取り出し → トークン取得 → Executor 実行
  - [x] イベントを Redis Pub/Sub で配信
  - [x] イベントを JobLog テーブルに保存 (thinking を除く)
  - [x] 完了/失敗時にジョブステータス更新
  - [x] 作業ディレクトリのクリーンアップ
  - [x] concurrency: 3
- [x] sandbox.ts (作業ディレクトリ管理)
- [x] TokenVault (AES-256-GCM 暗号化)
- [x] TokenRefresher (分散ロック付き自動リフレッシュ)
  - [x] アクセストークン期限5分前に自動リフレッシュ
  - [x] Redis 分散ロック (SET NX EX 30)
  - [x] ダブルチェックパターン
  - [x] ロック待ちポーリング (最大10秒)
  - [x] 定期バッチ (cron 1時間ごと)

## Phase 3: Slack Bot 実装

- [x] Slack Bolt セットアップ (Socket Mode)
- [x] メンション検知 (app_mention イベント)
- [x] 未連携ユーザー自動認証誘導
  - [x] ephemeral メッセージで「GitHubで連携する」ボタン表示
  - [x] pendingTask を Redis に一時保存
- [x] OAuth コールバック処理
  - [x] state 検証 (CSRF 防止)
  - [x] トークン取得・暗号化保存
  - [x] AccountLink 登録
  - [x] 連携完了 DM 通知
- [x] pendingTask 自動リトライ（「続行しますか？」ボタン）
- [x] ワンライナーパターン (owner/repo の自動検出 + リポジトリ検証)
- [x] インタラクティブパターン (external_select でリポジトリ選択)
- [x] external_select データソース (options ハンドラー)
- [x] ブランチ選択 (モーダル)
- [x] 確認画面
- [x] ボタン本人認証ミドルウェア (validateActionOwner)
- [x] JobGuard チェック
- [x] ジョブ投入 + キュー位置通知
- [x] JobStreamRelay (Redis Pub/Sub → スレッド投稿)
- [x] バッファリング (2秒間隔)
- [x] イベントフォーマット (agent_step→💭, tool_call→🔧, shell→📟, file_edit→📝, error→❌, done→✅)
- [x] 🛑 停止ボタン (インラインボタン → Redis キャンセル信号)
- [x] cancelled イベント処理
- [x] Slack Canvas 対応 (1スレッド1Canvas・リッチマークダウン描画)
  - [x] ThreadCanvas DB モデル（platform/channelId/threadId で一意管理）
  - [x] CanvasManager サービス（getOrCreateThreadCanvas / updateThreadCanvas / buildCanvasMarkdown）
  - [x] JobStreamRelay Canvas 統合（進捗・完了・エラーを Canvas に反映）
  - [x] Canvas URL をキュー通知メッセージに含める
  - [x] docs/slack-canvas.md 設計書

## Phase 4: Discord Bot 実装

- [x] Discord.js セットアップ
- [x] メンション検知 (messageCreate イベント)
- [x] 未連携ユーザー認証誘導
  - [x] DM にボタン表示
  - [x] DM ブロック時のチャンネルフォールバック
  - [x] pendingTask を Redis に一時保存
- [ ] OAuth コールバック処理 (Discord 版)
- [x] StringSelectMenu リポジトリ選択 (最大25件)
- [x] ブランチ選択
- [x] 確認 → 実行
- [x] MessageComponentCollector (タイムアウト: 2分)
- [x] JobStreamRelay (Redis Pub/Sub → スレッド投稿)
- [x] ストリーミング投稿 (2000文字チャンク分割)
- [x] 🛑 停止ボタン (ButtonComponent → Redis キャンセル信号)
- [x] cancelled イベント処理

## Phase 5: ReactAdmin 管理画面

- [x] ReactAdmin v5 セットアップ
- [x] dataProvider (REST API)
- [x] authProvider (JWT + GitHub OAuth)
- [x] ロールベース UI 分岐 (permissions で ADMIN/USER)
- [x] 管理者モード: UserList
- [x] 管理者モード: UserEdit (ロール変更)
- [x] 管理者モード: JobList (全ユーザーのジョブ)
- [x] 管理者モード: JobShow
- [x] 管理者モード: McpToolConfig (グローバルツール管理)
- [x] 管理者モード: SystemSettings
- [x] 利用者モード: Dashboard
- [x] 利用者モード: MyJobs (自分のジョブ一覧)
- [x] 利用者モード: MyInstructions (インストラクション管理)
- [x] 利用者モード: AccountLink (アカウント連携)
- [x] 利用者モード: McpToolSettings (個人MCPツール設定)
- [x] JobStatusBadge コンポーネント
- [x] LogViewer コンポーネント
  - [x] 既存ログの取得
  - [x] 実行中ジョブの SSE リアルタイム購読
  - [x] モノスペースフォントのターミナル風表示
  - [x] LIVE バッジ + LinearProgress
- [x] SSE エンドポイント (/api/jobs/:jobId/stream)

## Phase 6: MCPツール設定・インストラクション管理

- [x] MCPツール CRUD API
  - [x] 一覧取得 (グローバル + 個人)
  - [x] 作成 (管理者: グローバル可、利用者: 個人のみ)
  - [x] 更新
  - [x] 削除
- [x] グローバル/個人 MCPツール管理 (isGlobal フラグ)
- [x] MCP設定ファイル Worker 注入 (~/.copilot-cli/config.json)
- [x] インストラクション CRUD API
  - [x] 一覧取得 (自分のみ)
  - [x] 作成
  - [x] 更新
  - [x] 削除
- [x] グローバル/個人 インストラクション管理 (isGlobal フラグ)
  - [x] グローバルインストラクション管理 API (管理者専用)
  - [x] Worker: グローバル + 個人インストラクションを統合してプロンプト注入
  - [x] 管理画面: GlobalInstructionConfig ページ追加
- [x] インストラクション → プロンプト結合 (isActive: true のみ)
- [x] ReactAdmin 設定画面 (McpToolConfig, McpToolSettings, MyInstructions)

## Phase 7: セキュリティ強化・テスト・ドキュメント

### セキュリティ

- [x] トークン暗号化 (AES-256-GCM + 環境変数マスターキー)
- [x] 実行分離 (ジョブ単位の一時ディレクトリ + 完了後クリーンアップ)
- [x] 危険コマンドブロックリスト (--deny-tool)
- [x] レート制限 (JobGuard: maxConcurrentPerUser, maxConcurrentPerRepo, maxDailyPerUser, cooldown)
- [x] 監査ログ (ジョブ作成・キャンセル・トークン操作・ロール変更)

### テスト

- [x] 単体テスト: output-parser
- [x] 単体テスト: token-vault (暗号化・復号化)
- [x] 単体テスト: job-guard
- [x] 単体テスト: streaming フォーマッター
- [x] 統合テスト: POST /api/jobs
- [x] 統合テスト: GET /api/jobs/:id/stream (SSE)
- [x] 統合テスト: OAuth コールバック
- [x] E2E テスト: ジョブ作成→実行→完了フロー

### ドキュメント

- [x] README.md (セットアップガイド完成版)
- [x] 環境変数一覧ドキュメント (docs/env-variables.md)
- [x] API リファレンス (docs/api-reference.md)

## 軽量セッション（継続チャット）

- [x] DBスキーマ: Job.parentJobId 追加 + JobSession 自己リレーション
- [x] マイグレーション: 20260311104453_add_parent_job_session
- [x] worker/executor.ts: previousContext を ExecuteOptions に追加、buildPrompt に「前回の作業サマリー」セクション注入
- [x] worker/job-processor.ts: parentJobId から parent.resultSummary + prUrl を取得して executor に渡す
- [x] bot/mention.ts: thread_ts ?? ts でスレッドID正規化
- [x] bot/task.ts: submitJob で threadId による前回 COMPLETED ジョブ検索 → parentJobId 設定
- [x] bot/discord-task.ts: submitDiscordJob で channelId による前回 COMPLETED ジョブ検索 → parentJobId 設定
- [x] docs/session-strategy.md 作成
- [x] docs/database-schema.md 更新

## 着地期待値（DeliverableType）

- [x] prisma/schema.prisma: DeliverableType enum 追加、Job.deliverableType フィールド追加
- [x] prisma/migrations/20260311105939_add_deliverable_type: マイグレーション SQL 作成・適用
- [x] packages/worker/src/executor.ts: DeliverableType 型・DELIVERABLE_INSTRUCTIONS 定数追加、buildPrompt に deliverableType 分岐
- [x] packages/worker/src/job-processor.ts: deliverableType を executor に渡す（Prisma enum → lowercase 変換）
- [x] packages/bot/src/handlers/task.ts: DeliverableType 型・DELIVERABLE_LABELS 追加、TaskContext に deliverableType 追加、showConfirmation を 4 ボタン形式に変更、submitJob で deliverableType を DB 保存
- [x] packages/bot/src/handlers/interactive.ts: ブランチ選択モーダルに着地期待値 static_select 追加、select_branch submit で submitJob を直接呼び出し、submit_job アクションハンドラー追加
- [x] packages/bot/src/handlers/discord-task.ts: DeliverableType 型追加、showDiscordDeliverableSelect 関数追加、ブランチ選択後に DeliverableSelect フローへ、submitDiscordJob に deliverableType 引数追加
- [x] packages/api/src/routes/jobs.ts: POST /api/jobs に deliverableType パラメータ追加（バリデーション・デフォルト "pr"）

## Phase 8: Skills 機能

- [x] prisma/schema.prisma: SkillScope enum・Skill モデル追加、User.skills リレーション追加
- [x] prisma/migrations/20260313000000_add_skills: マイグレーション SQL 作成
- [x] packages/worker/src/skill-deployer.ts: deploySkills/getActiveSkills 実装（パストラバーサル対策込み）
- [x] packages/worker/src/executor.ts: ExecuteOptions に userId 追加、deploySkills 呼び出し・--skills-dir フラグ統合
- [x] packages/worker/src/job-processor.ts: executor.execute() に userId を渡す
- [x] packages/api/src/routes/skills.ts: Skills CRUD API（個人スキル + グローバルスキル/global）
- [x] packages/api/src/index.ts: /api/skills ルート登録
- [x] packages/frontend/src/pages/admin/GlobalSkillConfig.tsx: 管理者向けグローバルスキル管理画面
- [x] packages/frontend/src/pages/user/MySkills.tsx: ユーザー向け個人スキル管理画面
- [x] packages/frontend/src/App.tsx: skills/global・skills リソース登録

## local-agent 機能

- [x] prisma/schema.prisma: AgentStatus enum・ExecutionMode enum・LocalAgent モデル追加、Job に executionMode/localAgentId 追加、User に localAgents リレーション追加
- [x] prisma/migrations/20260314054400_add_local_agent: マイグレーション作成・適用
- [x] packages/api/src/routes/agents.ts: エージェント用 API エンドポイント群（register/heartbeat/me/claim/events/complete/fallback）
- [x] local-agent/worker の完了 summary は最長ではなく最後の assistant.message を採用
- [x] packages/api/src/index.ts: /api/agents ルート登録
- [x] packages/api/src/routes/users.ts: ユーザー一覧に localAgents をインクルード
- [x] packages/bot/src/handlers/task.ts: TaskContext に executionMode/localAgentId 追加、submitJob に LOCAL モード分岐
- [x] packages/bot/src/handlers/interactive.ts: ブランチ選択モーダルに実行モード選択追加（ONLINE エージェント存在時のみ）
- [x] packages/bot/src/handlers/discord-task.ts: showDiscordDeliverableSelect に実行モード選択追加
- [x] packages/frontend/src/pages/admin/UserList.tsx: LocalAgentStatusField コンポーネント追加
- [x] packages/frontend/src/pages/user/Dashboard.tsx: AgentStatusCard コンポーネント追加
- [x] packages/local-agent/package.json: npm 公開設定（catapult-agent CLI）
- [x] packages/local-agent/tsconfig.json: TypeScript 設定
- [x] packages/local-agent/src/config.ts: ~/.catapult/config.json の読み書き
- [x] packages/local-agent/src/event-reporter.ts: イベントバッファリング送信（2秒間隔）
- [x] packages/local-agent/src/workspace-resolver.ts: .git/config の remote URL による動的リポジトリ解決
- [x] packages/local-agent/src/executor.ts: clone なし LocalCopilotExecutor
- [x] packages/local-agent/src/agent.ts: ハートビート＋ポーリングメインループ（30秒間隔）
- [x] packages/local-agent/src/index.ts: CLI エントリーポイント（init/start コマンド）

## catapult-agent NPM パッケージ公開

- [x] packages/local-agent/package.json: keywords・license・repository・homepage・publishConfig・prepublishOnly を追加
- [x] packages/local-agent/README.md: インストール・セットアップ・コマンド一覧ドキュメント作成

## 本番運用ドキュメント

- [x] docs/operations.md: サーバー導入・Slack/Discord Bot パーミッション設定・ローカルエージェント設定・日常運用・トラブルシューティング・バックアップ手順を網羅した運用マニュアル作成

## 次期改善: WorkerとLocalAgentのコアロジック共有化

[設計書: docs/refactoring-core-shared-logic.md](./docs/refactoring-core-shared-logic.md)

- [x] `packages/core` 新規パッケージ作成・初期化
- [x] プロンプト構築（`prompt-builder.ts`）・結果解析（`output-parser.ts`）・共通型（`types.ts`）の移行
- [x] API（`routes/agents.ts`）の claim 時のデータ拡充、complete 時のスキーマ変更
- [x] `packages/worker` リファクタ: `@catapult/core` 利用への切り替え
- [x] `packages/local-agent` リファクタ: プロンプト対応、`CATAPULT_SUMMARY.md` 読み取り＆クリーンアップ処理の追加
