# CATAPULT - Copilot Instructions

## プロジェクト概要

CATAPULT は、Slack/Discord から GitHub Copilot CLI を呼び出す開発サーバーです。
ユーザーが `@copilot` にメンションするだけで、自律的にコーディング作業を行います。

## 設計書の所在

設計書は `docs/` ディレクトリに格納されています。実装前に必ず対応する設計書を確認してください。

- `docs/overview.md` - プロジェクト概要
- `docs/architecture.md` - アーキテクチャ設計
- `docs/database-schema.md` - データベース設計
- `docs/authentication.md` - 認証設計
- `docs/streaming.md` - ストリーミング設計
- `docs/concurrency.md` - 同時実行安全性設計
- `docs/tech-stack.md` - 技術スタック・Linter設定
- `docs/phase1-foundation.md` 〜 `docs/phase7-security-testing.md` - フェーズ別設計

## コーディング規約

### 言語・ランタイム

- TypeScript (strict mode) で記述すること
- Node.js 22 をターゲットとする
- npm workspaces によるモノレポ構成

### コードスタイル

- ESLint v9 (Flat Config) に従うこと
- Prettier でフォーマットすること
- コミット前に `npm run check` (typecheck + lint + format:check) が通ることを確認
- `eslint.config.mjs` の設定を遵守:
  - 未使用変数はエラー（`_` プレフィックスのみ許可）
  - `any` は原則使わない（やむを得ない場合は warn）
  - import 順序: builtin → external → internal → parent → sibling → index
  - `console.log` は使わない（`console.warn`, `console.error`, `console.info` は可）
  - React コンポーネントでは react-hooks のルールに従う

### ファイル構成

- 各パッケージは `packages/` 配下に配置
- パッケージ: api, bot, worker, frontend
- 各パッケージのソースコードは `src/` 配下に配置
- テストファイルは `*.test.ts` または `*.spec.ts` の命名規則

### データベース

- Prisma を使用
- スキーマ変更時は `prisma/schema.prisma` を更新し、マイグレーションを作成
- `docs/database-schema.md` も同時に更新すること

### Git

- コミットメッセージは Conventional Commits に従う (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`)
- PR のタイトルも同様

### タスク管理

- タスク完了時は `TASKS.md` のチェックボックスを更新すること
- 新しいタスクが発生した場合も `TASKS.md` に追加すること

### セキュリティ

- トークンやシークレットをハードコードしないこと
- 環境変数を使用し、`.env.example` に変数名のみ記載
- ユーザー入力は必ずバリデーションすること
- GitHub トークンは必ず AES-256-GCM で暗号化して DB に保存すること
- ジョブ実行時はジョブ単位の一時ディレクトリを使用し、完了後に削除すること

### Linter による整合性

- Lint エラーが発生した場合は、まず `npm run lint:fix` による自動修正を試みること
- すべてのコード変更後に `npm run lint:fix && npm run format` を実行すること
- CI でチェックが通らない PR はマージしないこと
- 型エラー (`tsc --noEmit`) がゼロであることを確認すること
