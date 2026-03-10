# CATAPULT - 認証設計（OAuth フロー）

## 概要

CATAPULT は GitHub App の OAuth フローを使用します。PAT（Personal Access Token）は不要で、GitHub App の user-to-server トークン（`ghu_` で始まるトークン）を使用します。

## GitHub App 設定

### 必要な権限（Permissions）

| 権限               | レベル     | 説明                         |
| ------------------ | ---------- | ---------------------------- |
| `Contents`         | Read/Write | リポジトリのコード読み書き   |
| `Pull requests`    | Read/Write | PR の作成・更新              |
| `Issues`           | Read/Write | Issue の読み書き             |
| `Metadata`         | Read       | リポジトリ一覧取得           |
| `Copilot Requests` | -          | Copilot CLI の実行権限       |
| `Email addresses`  | Read       | ユーザーのメールアドレス取得 |

### 設定項目

- **User-to-server token expiration**: 有効（アクセストークン: 8時間、リフレッシュトークン: 約6ヶ月）
- **Callback URL**: `https://<your-domain>/api/auth/github/callback`
- **Setup URL**: `https://<your-domain>/api/auth/github/setup`

## 初回メンション時の認証フロー

```
1. ユーザーが Slack/Discord で @copilot とメンション
         ↓
2. Bot が AccountLink テーブルを参照してアカウント連携確認
         ↓
3. 未連携の場合:
   → Slack: ephemeral メッセージで「GitHubで連携する」ボタン表示
   → Discord: DM または チャンネルにボタン表示
   → タスク内容を pendingTask としてセッションに保存
         ↓
4. ユーザーがボタンをクリック
   → state パラメータを生成して Redis に一時保存（TTL: 600秒）
   → GitHub OAuth 認可ページにリダイレクト
         ↓
5. ユーザーが GitHub で認可
   → GitHub がコールバック URL にリダイレクト（code + state パラメータ付き）
         ↓
6. API Server がコールバック処理:
   a. state を Redis で検証（CSRF 防止）
   b. code を user-to-server トークンと交換
   c. GitHub API でユーザー情報取得
   d. トークンを AES-256-GCM で暗号化して DB に保存
   e. AccountLink テーブルに Slack/Discord ID と GitHub アカウントを紐付け
   f. Slack/Discord の DM で「連携完了」通知
         ↓
7. pendingTask がある場合:
   → 「先ほどのタスクを続行しますか？」ボタン付きメッセージを表示
```

## スラッシュコマンド不要の設計

メンション時に未連携であれば自動的に認証フローに誘導するため、ユーザーはスラッシュコマンドで事前に連携する必要がありません。

## トークン管理

### トークンの種類

| トークン種別         | 有効期限 | 用途                          |
| -------------------- | -------- | ----------------------------- |
| アクセストークン     | 8時間    | GitHub API / Copilot CLI 実行 |
| リフレッシュトークン | 約6ヶ月  | アクセストークンの再取得      |

### 自動リフレッシュフロー

アクセストークンの期限が切れる前に自動的にリフレッシュします。

```typescript
// token-refresher.ts の概念実装

async function refreshTokenIfNeeded(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  // アクセストークンの有効期限が5分以内の場合にリフレッシュ
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (user.tokenExpiresAt && user.tokenExpiresAt > fiveMinutesFromNow) {
    return decrypt(user.githubToken);
  }

  // 分散ロックを取得してリフレッシュ（競合防止）
  const lockKey = `token:refresh:lock:${userId}`;
  const lockAcquired = await redis.set(lockKey, "1", "EX", 30, "NX");

  if (!lockAcquired) {
    // ロック待ちポーリング（最大10秒）
    return await waitForRefresh(userId);
  }

  try {
    // ダブルチェック（別プロセスがリフレッシュ済みの可能性）
    const freshUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (freshUser.tokenExpiresAt && freshUser.tokenExpiresAt > fiveMinutesFromNow) {
      return decrypt(freshUser.githubToken);
    }

    // リフレッシュトークンでアクセストークンを更新
    const newTokens = await githubApp.refreshUserToken(decrypt(freshUser.refreshToken!));

    await prisma.user.update({
      where: { id: userId },
      data: {
        githubToken: encrypt(newTokens.token),
        refreshToken: encrypt(newTokens.refreshToken),
        tokenExpiresAt: newTokens.expiresAt,
        refreshTokenExpiresAt: newTokens.refreshTokenExpiresAt,
      },
    });

    return newTokens.token;
  } finally {
    await redis.del(lockKey);
  }
}
```

### 定期バッチリフレッシュ

cron ジョブ（1時間ごと）で期限の近いトークンを先回りリフレッシュします。

```typescript
// cron 設定（毎時0分）
cron.schedule("0 * * * *", async () => {
  // 今から2時間以内に期限が切れるトークンを取得
  const expiringUsers = await prisma.user.findMany({
    where: {
      tokenExpiresAt: {
        lte: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    },
  });

  for (const user of expiringUsers) {
    await refreshTokenIfNeeded(user.id).catch(console.error);
  }
});
```

### リフレッシュトークン期限切れ時

リフレッシュトークンが期限切れの場合は再ログインが必要です。

- Slack/Discord に「GitHub 連携が切れました。再連携してください」という DM を送信
- 再連携ボタンを表示

## トークン暗号化

トークンは AES-256-GCM で暗号化して DB に保存します。

```typescript
// token-vault.ts

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "hex"); // 32 bytes = 64 hex chars

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv:authTag:encrypted を Base64 で結合
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(
    ":",
  );
}

export function decrypt(ciphertext: string): string {
  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(":");
  const iv = Buffer.from(ivB64!, "base64");
  const authTag = Buffer.from(authTagB64!, "base64");
  const encrypted = Buffer.from(encryptedB64!, "base64");
  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf8");
}
```

## CSRF 防止

OAuth フローの state パラメータを Redis に一時保存することで CSRF を防止します。

```typescript
// state 生成・保存
const state = randomBytes(32).toString("hex");
await redis.set(`oauth:state:${state}`, JSON.stringify({ slackUserId, pendingTask }), "EX", 600);

// コールバック時の検証
const data = await redis.get(`oauth:state:${state}`);
if (!data) throw new Error("Invalid or expired state");
await redis.del(`oauth:state:${state}`); // 使い捨て
```

## アカウント連携管理

### AccountLink テーブル

```
AccountLink {
  platform:       SLACK | DISCORD
  platformUserId: Slack/Discord のユーザー ID
  platformTeamId: Slack ワークスペース ID / Discord サーバー ID
  userId:         CATAPULT の User ID
}
```

ユニーク制約 `[platform, platformUserId]` により、1つの Slack/Discord アカウントに1つの GitHub アカウントのみ紐付けられます。

### 連携解除

管理画面またはコマンドで連携解除が可能です。連携解除するとジョブの実行ができなくなります。

## JWT 認証（管理画面）

ReactAdmin 管理画面では JWT を使用します。

- GitHub OAuth でログイン後、API サーバーが JWT を発行
- JWT には `userId`, `role` を含める
- 有効期限: 24時間
- リフレッシュトークン（管理画面用）: 30日
