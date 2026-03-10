# API リファレンス

CATAPULT API の全エンドポイント一覧です。

## 認証

JWT ベアラートークンを `Authorization` ヘッダーに含めてください。

```
Authorization: Bearer <jwt-token>
```

SSE ストリームエンドポイントではクエリパラメータも受け付けます。

```
GET /api/jobs/:id/stream?token=<jwt-token>
```

JWT トークンは `/api/auth/github/callback` で取得します（GitHub OAuth フロー）。

---

## 認証エンドポイント

### `GET /api/auth/github`

GitHub OAuth 認証を開始します。

**クエリパラメータ:**

| パラメータ | 必須 | 説明                                              |
| ---------- | ---- | ------------------------------------------------- |
| `redirect` | △    | Web管理画面フロー用。フロントエンドのベースURL    |
| `state`    | △    | Bot フロー用。プラットフォーム情報を含む state 値 |
| `platform` | ×    | Bot フロー用 (`slack` / `discord`)                |

**レスポンス:** GitHub OAuth 認可ページへのリダイレクト

---

### `GET /api/auth/github/callback`

GitHub OAuth コールバック。認証完了後にフロントエンドへリダイレクトします。

**クエリパラメータ:**

| パラメータ | 必須 | 説明                    |
| ---------- | ---- | ----------------------- |
| `code`     | ✅   | GitHub OAuth 認可コード |
| `state`    | ✅   | CSRF 防止用 state 値    |

**Web フローレスポンス:** `{redirectUrl}/auth/callback?token=<jwt>&role=<role>` へリダイレクト

---

### `GET /api/auth/me`

**認証:** JWT 必須

ログイン中のユーザー情報を取得します。

**レスポンス:**

```json
{
  "id": "user-id",
  "githubUsername": "octocat",
  "githubAvatarUrl": "https://avatars.githubusercontent.com/...",
  "role": "USER"
}
```

---

### `GET /api/auth/me/links`

**認証:** JWT 必須

ユーザーのアカウント連携一覧を取得します。

**レスポンス:**

```json
[
  { "platform": "SLACK", "platformUserId": "U12345678" },
  { "platform": "DISCORD", "platformUserId": "123456789012345678" }
]
```

---

## ジョブエンドポイント

### `GET /api/jobs`

**認証:** JWT 必須

自分のジョブ一覧を取得します。

**クエリパラメータ:**

| パラメータ | デフォルト  | 説明                      |
| ---------- | ----------- | ------------------------- |
| `_start`   | `0`         | ページネーション開始位置  |
| `_end`     | `10`        | ページネーション終了位置  |
| `_sort`    | `createdAt` | ソートフィールド          |
| `_order`   | `DESC`      | ソート順 (`ASC` / `DESC`) |

**レスポンスヘッダー:** `Content-Range: jobs <start>-<end>/<total>`

---

### `POST /api/jobs`

**認証:** JWT 必須

新しいジョブを作成してキューに投入します。

**リクエストボディ:**

```json
{
  "repository": "owner/repo",
  "branch": "main",
  "prompt": "バグを修正してPRを作成してください"
}
```

**レスポンス (201):**

```json
{
  "id": "job-id",
  "userId": "user-id",
  "repository": "owner/repo",
  "branch": "main",
  "prompt": "...",
  "status": "PENDING",
  "platform": "API",
  "createdAt": "2026-03-10T00:00:00.000Z",
  "updatedAt": "2026-03-10T00:00:00.000Z"
}
```

---

### `GET /api/jobs/:id`

**認証:** JWT 必須（自分のジョブまたは管理者）

ジョブ詳細を取得します。

**レスポンス (200):**

```json
{
  "id": "job-id",
  "status": "COMPLETED",
  "repository": "owner/repo",
  "branch": "main",
  "prompt": "...",
  "prUrl": "https://github.com/owner/repo/pull/1",
  "resultSummary": "バグを修正してPRを作成しました"
}
```

---

### `DELETE /api/jobs/:id`

**認証:** JWT 必須（自分のジョブまたは管理者）

実行中/待機中のジョブをキャンセルします。

**レスポンス (200):**

```json
{ "id": "job-id" }
```

**エラー:**

- `400` - ジョブがキャンセル可能な状態でない (`COMPLETED` / `FAILED` / `CANCELLED`)
- `403` - 他のユーザーのジョブ
- `404` - ジョブが見つからない

---

### `GET /api/jobs/:id/stream`

**認証:** JWT 必須（Bearer ヘッダーまたは `?token=` クエリパラメータ）

ジョブのログをリアルタイムで SSE ストリーム配信します。

**レスポンスヘッダー:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**イベント形式:**

```
data: {"eventType":"agent_step","content":"作業を開始します","timestamp":"..."}

data: {"eventType":"tool_call","tool":"create_file","content":"...","timestamp":"..."}

data: {"eventType":"done","content":"...","timestamp":"..."}
```

---

### `GET /api/jobs/all`

**認証:** JWT 必須・管理者のみ

全ユーザーのジョブ一覧を取得します。`GET /api/jobs` と同じクエリパラメータをサポートします。

---

## MCPツールエンドポイント

### `GET /api/mcp-tools`

**認証:** JWT 必須

自分の個人 MCPツール一覧を取得します。

---

### `POST /api/mcp-tools`

**認証:** JWT 必須

個人 MCPツールを作成します。

**リクエストボディ:**

```json
{
  "name": "my-tool",
  "description": "カスタムツール",
  "endpoint": "https://example.com/api/tool",
  "method": "POST",
  "enabled": true
}
```

---

### `GET /api/mcp-tools/:id`

**認証:** JWT 必須（自分のツールまたは管理者）

MCPツール詳細を取得します。

---

### `PUT /api/mcp-tools/:id`

**認証:** JWT 必須（自分のツールまたは管理者）

MCPツールを更新します。

---

### `DELETE /api/mcp-tools/:id`

**認証:** JWT 必須（自分のツールまたは管理者）

MCPツールを削除します。

---

### `GET /api/mcp-tools/global`

**認証:** JWT 必須・管理者のみ

グローバル MCPツール一覧を取得します。

---

### `POST /api/mcp-tools/global`

**認証:** JWT 必須・管理者のみ

グローバル MCPツールを作成します。

---

### `PUT /api/mcp-tools/global/:id`

**認証:** JWT 必須・管理者のみ

グローバル MCPツールを更新します。

---

### `DELETE /api/mcp-tools/global/:id`

**認証:** JWT 必須・管理者のみ

グローバル MCPツールを削除します。

---

## インストラクションエンドポイント

### `GET /api/instructions`

**認証:** JWT 必須

自分のインストラクション一覧を取得します。

---

### `POST /api/instructions`

**認証:** JWT 必須

インストラクションを作成します。

**リクエストボディ:**

```json
{
  "name": "コーディング規約",
  "content": "TypeScript strict モードを使用してください...",
  "isActive": true
}
```

---

### `GET /api/instructions/:id`

**認証:** JWT 必須（自分のインストラクションのみ）

インストラクション詳細を取得します。

---

### `PUT /api/instructions/:id`

**認証:** JWT 必須（自分のインストラクションのみ）

インストラクションを更新します。

---

### `DELETE /api/instructions/:id`

**認証:** JWT 必須（自分のインストラクションのみ）

インストラクションを削除します。

---

## ユーザーエンドポイント（管理者のみ）

### `GET /api/users`

**認証:** JWT 必須・管理者のみ

全ユーザー一覧を取得します。

---

### `GET /api/users/:id`

**認証:** JWT 必須・管理者のみ

ユーザー詳細を取得します。

---

### `PUT /api/users/:id`

**認証:** JWT 必須・管理者のみ

ユーザーのロールを変更します。

**リクエストボディ:**

```json
{ "role": "ADMIN" }
```

有効な値: `"ADMIN"` / `"USER"`

---

## ヘルスチェック

### `GET /health`

**認証:** 不要

サーバーの稼働状態を確認します。

**レスポンス:**

```json
{ "status": "ok" }
```

---

## エラーレスポンス形式

全エラーレスポンスは以下の形式で返されます:

```json
{ "error": "エラーメッセージ" }
```

**一般的なステータスコード:**

| コード | 説明                                    |
| ------ | --------------------------------------- |
| `400`  | リクエストが不正                        |
| `401`  | 未認証（トークンなし / 無効なトークン） |
| `403`  | 権限不足                                |
| `404`  | リソースが見つからない                  |
| `500`  | サーバー内部エラー                      |
