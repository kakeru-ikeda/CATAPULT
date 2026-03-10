# Phase 7: セキュリティ強化・テスト・ドキュメント

## 目的

CATAPULT をプロダクション環境で安全に運用できるよう、セキュリティの強化・テストの整備・ドキュメントの完成を行います。

## 期間目安

**1週間**

## タスク一覧

### 1. セキュリティ強化

#### トークン暗号化 (AES-256-GCM)

`packages/api/src/services/token-vault.ts` の実装（`docs/authentication.md` 参照）:

- AES-256-GCM アルゴリズムを使用
- IV (初期化ベクトル) はランダム生成（12 bytes）
- 認証タグ (auth tag) で改ざん検知
- 環境変数 `TOKEN_ENCRYPTION_KEY` をマスターキーとして使用（32 bytes hex）

```typescript
// マスターキー生成コマンド（セットアップ時に実行）
// node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### 実行分離

各ジョブは独立した一時ディレクトリで実行し、完了後に削除します（`docs/concurrency.md` 参照）:

```
/tmp/copilot-jobs/{jobId}/
├── workspace/     ← git clone ディレクトリ
└── home/          ← Copilot CLI の HOME（MCP設定含む）
```

#### 危険コマンドのブロックリスト

Copilot CLI の `--deny-tool` オプションで危険なツールをブロックします:

```typescript
const DENIED_TOOLS = [
  "delete_repo",
  "transfer_repo",
  "archive_repo",
  // 必要に応じて追加
];

const args = [
  "--autopilot",
  "--allow-all",
  "--output",
  "json",
  ...DENIED_TOOLS.flatMap((tool) => ["--deny-tool", tool]),
  "-p",
  prompt,
];
```

#### レート制限 (JobGuard)

`packages/api/src/services/job-guard.ts` の実装（`docs/concurrency.md` 参照）:

- ユーザーあたりの最大同時実行数: 3
- リポジトリあたりの最大同時実行数: 2
- 1日あたりの上限: 50件
- クールダウン: 10秒

#### 監査ログ

全ての重要な操作をログに記録します:

```typescript
// packages/api/src/middleware/audit-log.ts

export async function auditLog(
  userId: string,
  action: string,
  resource: string,
  details?: object,
): Promise<void> {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      userId,
      action,
      resource,
      details,
    }),
  );
  // 必要に応じて DB にも保存
}
```

監査対象の操作:

- ジョブの作成・キャンセル
- トークンのリフレッシュ・失効
- MCPツールの変更
- ユーザーロールの変更
- 管理者によるユーザー操作

### 2. テスト

#### 単体テスト (Vitest)

```bash
npm install -D vitest @vitest/coverage-v8
```

テスト対象:

```typescript
// packages/worker/src/output-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseCopilotEvent, extractPrUrl } from "./output-parser";

describe("parseCopilotEvent", () => {
  it("有効な JSON を正しくパースする", () => {
    const line = '{"type":"agent_step","content":"作業を開始します"}';
    const event = parseCopilotEvent(line);
    expect(event).toEqual({ type: "agent_step", content: "作業を開始します" });
  });

  it("無効な JSON は null を返す", () => {
    expect(parseCopilotEvent("invalid json")).toBeNull();
  });
});

describe("extractPrUrl", () => {
  it("done イベントから PR URL を抽出する", () => {
    const events = [
      { type: "done", prUrl: "https://github.com/owner/repo/pull/42" } as CopilotEvent,
    ];
    expect(extractPrUrl(events)).toBe("https://github.com/owner/repo/pull/42");
  });
});
```

```typescript
// packages/api/src/services/token-vault.test.ts
import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "./token-vault";

describe("token-vault", () => {
  it("暗号化・復号化が正しく動作する", () => {
    const original = "ghu_test_token_12345";
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(decrypt(encrypted)).toBe(original);
  });

  it("同じ平文でも毎回異なる暗号文になる（IV がランダム）", () => {
    const original = "test";
    expect(encrypt(original)).not.toBe(encrypt(original));
  });
});
```

#### 統合テスト (API + DB)

```typescript
// packages/api/src/routes/jobs.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../index";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

describe("POST /api/jobs", () => {
  it("有効なリクエストでジョブが作成される", async () => {
    const response = await request(app)
      .post("/api/jobs")
      .set("Authorization", `Bearer ${testToken}`)
      .send({
        repository: "owner/repo",
        branch: "main",
        prompt: "バグを修正してPRを作成してください",
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("PENDING");
  });

  it("未認証では 401 が返る", async () => {
    const response = await request(app).post("/api/jobs").send({});
    expect(response.status).toBe(401);
  });
});
```

#### E2Eテスト

主要なフローのエンドツーエンドテスト:

1. GitHub OAuth 認証フロー
2. ジョブ作成からキュー投入
3. Worker によるジョブ処理
4. ストリーミングログの受信

### 3. ドキュメント

#### README.md（セットアップガイド）

```markdown
# CATAPULT

## セットアップ

### 前提条件

- Node.js 22+
- Docker Compose

### インストール

1. `git clone https://github.com/your-org/catapult`
2. `cp .env.example .env`（各環境変数を設定）
3. `npm install`
4. `docker compose up -d postgres redis`
5. `npx prisma migrate deploy`
6. `docker compose up`

### GitHub App の設定

1. GitHub で新しい App を作成
2. 必要な権限を設定（docs/authentication.md 参照）
3. Client ID / Client Secret を .env に設定
4. Webhook URL を設定
```

#### 環境変数一覧ドキュメント

`.env.example` の各変数の説明を記載したドキュメント:

| 変数名                   | 説明                                       | 必須 |
| ------------------------ | ------------------------------------------ | ---- |
| `DATABASE_URL`           | PostgreSQL 接続 URL                        | ✅   |
| `REDIS_URL`              | Redis 接続 URL                             | ✅   |
| `GITHUB_APP_ID`          | GitHub App の App ID                       | ✅   |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App の秘密鍵（PEM 形式）            | ✅   |
| `GITHUB_CLIENT_ID`       | GitHub App の Client ID                    | ✅   |
| `GITHUB_CLIENT_SECRET`   | GitHub App の Client Secret                | ✅   |
| `TOKEN_ENCRYPTION_KEY`   | トークン暗号化マスターキー（64 hex chars） | ✅   |
| `SLACK_BOT_TOKEN`        | Slack Bot Token (`xoxb-` で始まる)         | △    |
| `SLACK_SIGNING_SECRET`   | Slack Signing Secret                       | △    |
| `SLACK_APP_TOKEN`        | Slack App Token (`xapp-` で始まる)         | △    |
| `DISCORD_BOT_TOKEN`      | Discord Bot Token                          | △    |
| `JWT_SECRET`             | JWT 署名シークレット                       | ✅   |
| `API_BASE_URL`           | API サーバーの公開 URL                     | ✅   |
| `VITE_API_URL`           | フロントエンドから API への URL            | ✅   |

△: Slack または Discord のいずれか1つは必須

#### API リファレンス

主要なエンドポイントを記載:

| メソッド | パス                        | 説明                      | 認証 |
| -------- | --------------------------- | ------------------------- | ---- |
| GET      | `/api/auth/github`          | GitHub OAuth 開始         | 不要 |
| GET      | `/api/auth/github/callback` | GitHub OAuth コールバック | 不要 |
| GET      | `/api/auth/me`              | ログインユーザー情報取得  | JWT  |
| POST     | `/api/jobs`                 | ジョブ作成                | JWT  |
| GET      | `/api/jobs`                 | ジョブ一覧（自分のみ）    | JWT  |
| GET      | `/api/jobs/:id`             | ジョブ詳細                | JWT  |
| DELETE   | `/api/jobs/:id`             | ジョブキャンセル          | JWT  |
| GET      | `/api/jobs/:id/stream`      | ジョブログ SSE ストリーム | JWT  |
| GET      | `/api/repos`                | リポジトリ一覧取得        | JWT  |
| GET      | `/api/repos/:repo/branches` | ブランチ一覧取得          | JWT  |
| GET      | `/api/mcp-tools`            | MCPツール一覧             | JWT  |
| POST     | `/api/mcp-tools`            | MCPツール作成             | JWT  |
| PUT      | `/api/mcp-tools/:id`        | MCPツール更新             | JWT  |
| DELETE   | `/api/mcp-tools/:id`        | MCPツール削除             | JWT  |
| GET      | `/api/instructions`         | インストラクション一覧    | JWT  |
| POST     | `/api/instructions`         | インストラクション作成    | JWT  |
| PUT      | `/api/instructions/:id`     | インストラクション更新    | JWT  |
| DELETE   | `/api/instructions/:id`     | インストラクション削除    | JWT  |

## 成果物

- `packages/api/src/middleware/audit-log.ts` - 監査ログ
- `packages/worker/src/output-parser.test.ts` - パーサー単体テスト
- `packages/api/src/services/token-vault.test.ts` - 暗号化単体テスト
- `packages/api/src/routes/jobs.test.ts` - API 統合テスト
- `README.md` - セットアップガイド（更新）
- `docs/env-variables.md` - 環境変数一覧
- `docs/api-reference.md` - API リファレンス

## 完了条件

- [ ] `TOKEN_ENCRYPTION_KEY` でトークンが AES-256-GCM 暗号化される
- [ ] `--deny-tool` で危険コマンドがブロックされる
- [ ] JobGuard がレート制限を正しく適用する
- [ ] 監査ログが記録される
- [ ] 全単体テストが green になる
- [ ] 全統合テストが green になる
- [ ] E2E テストが green になる
- [ ] README にセットアップ手順が完全に記載されている
- [ ] 全環境変数が `.env.example` と環境変数ドキュメントに記載されている
- [ ] API リファレンスが全エンドポイントを網羅している
