# コアロジック共有化のリファクタリング設計

## 背景・課題

現在の実装では、Copilot CLI を呼び出して処理を実行する Worker パッケージと、ローカル環境で実行する Local Agent パッケージが独立して実装されています。
その結果、以下の問題が発生しています。

1. **機能の格差（仕様漏れ）**:
   - Worker 側では完了時に `CATAPULT_SUMMARY.md` を書き出す堅牢なファイルベース結果出力アプローチを導入したが、Local Agent には反映されていない。
   - Worker 側では `PR作成` や `調査・報告` といった `DeliverableType`（モード指定）に基づいたシステムプロンプトの出し分けを行っているが、Local Agent には渡されていない。
2. **DRY 原則違反**:
   - Output Parser（結果抽出）、Prompt Builder（プロンプト構築）、イベント配信ロジックなどが複数パッケージに分散し、保守性が低下している。
3. **API 責務の混同**:
   - 現在の API (`/api/agents/jobs/:jobId/complete`) は、Local Agent に代わって JobLog から自力でサマリーテキストをパースしている。本来、結果テキストの抽出は実行環境側（Agent本体）で完結させるべき。

## 目的

モノレポ構成のポテンシャルを活かし、**「Copilotのメタな振る舞いを制御するロジック群」を `packages/core` という共通基盤として切り出し**、サーバーWorkerとLocal Agentの両方で動作を完全同期させます。

---

## アーキテクチャ更新案

### 1. `packages/core` パッケージの新設

プロンプト構築、結果ファイルの読み取り、パース処理を共通化します。

- **`prompt-builder.ts`**
  - `buildSystemPrompt({ deliverableType, prompt, instructions, previousContext, ... })`
  - 実行モードに応じた命令文や、「最終成果物を `CATAPULT_SUMMARY.md` に出力せよ」という制約を生成する。
- **`output-parser.ts`**
  - PRのURLを抽出する正規表現ロジックなどを共通化。
- **`types.ts`**
  - `DeliverableType`, `CopilotEvent` などの型定義を中央集権化。

### 2. API / DB 通信仕様の拡張（`/api/agents/*`）

Local Agent が Worker と同等の条件で実行できるよう、APIペイロードを拡張します。

- **`POST /api/agents/jobs/claim` のレスポンス拡張**
  - 現状: `prompt`, `repository`, `branch`
  - 追加: `deliverableType`, `instructions`, `previousContext`
- **`POST /api/agents/jobs/:jobId/complete` の変更**
  - Agent 自身が `CATAPULT_SUMMARY.md` を展開した上で成果物テキストと PR URL を POST する形に変更。
  - `body: { status: "COMPLETED", summary: string, prUrl?: string, error?: string }` に変更。
  - これに伴い API 側での独自ログパース処理は廃止。

### 3. Local Agent の改修

- `executor.ts`: 直接のプロンプト構築をやめ、`@catapult/core` の `buildSystemPrompt` を使用。
- `agent.ts`: 完了時にローカルリポジトリ（作業ディレクトリ直下）の `CATAPULT_SUMMARY.md` を読み取る。
- **重要**: ローカル環境を汚さないよう、`CATAPULT_SUMMARY.md` を読み取った直後に `fs.rm` でクリーンアップを行う。

### 4. Worker の改修

- `executor.ts`, `job-processor.ts` 内の独自ロジックを `@catapult/core` に置き換える。

---

## 移行ステップ

以下の順序で安全にリファクタリングを進めます。

1. **Step 1: 新規パッケージの作成と移植**
   - `packages/core` の作成、共通型(`types.ts`)、`output-parser.ts`、`prompt-builder.ts` の実装。
2. **Step 2: APIの改修**
   - `routes/agents.ts` の `claim` 戻り値と、`complete` の要求スキーマを変更。
3. **Step 3: Worker の追従**
   - `packages/worker` を改修し、`@catapult/core` のビルダー/パーサーを利用させる。
4. **Step 4: Local Agent の追従**
   - `packages/local-agent` で `@catapult/core` を利用。プロンプト構築の連携と、完了時の `CATAPULT_SUMMARY.md` 読み込み＆削除処理の実装。
