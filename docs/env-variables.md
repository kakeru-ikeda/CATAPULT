# 環境変数一覧

CATAPULT の動作に必要な環境変数の一覧です。`.env.example` をコピーして `.env` を作成し、各値を設定してください。

## 必須変数

| 変数名                     | 説明                                                    | 例                                               |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| `DATABASE_URL`             | PostgreSQL 接続 URL                                     | `postgresql://user:pass@localhost:5432/catapult` |
| `REDIS_URL`                | Redis 接続 URL                                          | `redis://localhost:6379`                         |
| `GITHUB_APP_CLIENT_ID`     | GitHub App の Client ID                                 | `Iv1.xxxxxxxxxxxxxxxx`                           |
| `GITHUB_APP_CLIENT_SECRET` | GitHub App の Client Secret                             | `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`       |
| `TOKEN_ENCRYPTION_KEY`     | トークン暗号化マスターキー（64文字の16進数 = 32 bytes） | ※生成コマンド参照                                |
| `JWT_SECRET`               | JWT 署名シークレット（十分なランダム性のある文字列）    | `your-secret-key`                                |
| `APP_URL`                  | API サーバーの公開 URL（OAuth コールバックに使用）      | `https://your-domain.com`                        |

## Slack Bot 用（Slack を使用する場合は必須）

| 変数名                 | 説明                                               | 例                 |
| ---------------------- | -------------------------------------------------- | ------------------ |
| `SLACK_BOT_TOKEN`      | Slack Bot Token (`xoxb-` で始まる)                 | `xoxb-xxxxx-xxxxx` |
| `SLACK_SIGNING_SECRET` | Slack Signing Secret                               | `xxxxxxxxxxxxxxxx` |
| `SLACK_APP_TOKEN`      | Slack App Token (`xapp-` で始まる、Socket Mode 用) | `xapp-xxxxx-xxxxx` |

## Discord Bot 用（Discord を使用する場合は必須）

| 変数名              | 説明              | 例                                                           |
| ------------------- | ----------------- | ------------------------------------------------------------ |
| `DISCORD_BOT_TOKEN` | Discord Bot Token | `MTxxxxxxxxxxxxxxxxxxxxxx.xxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxx` |

## Admin ローカルログイン用（オプション）

GitHub 認証なしで管理画面に入るための管理者 ID/パスワードです。
設定しない場合は GitHub OAuth のみが使用可能です。

| 変数名           | 説明                                                 | 例          |
| ---------------- | ---------------------------------------------------- | ----------- |
| `ADMIN_USERNAME` | 管理者ユーザー名（ローカルログイン用）               | `admin`     |
| `ADMIN_PASSWORD` | 管理者パスワード（十分な強度の文字列を使用すること） | `S3cr3t!pw` |

> **注意**: `ADMIN_PASSWORD` は推測されにくい十分に長いランダム文字列を使用してください。
> このアカウントは DB に保存されず、ADMIN ロールの JWT を直接発行します。

## フロントエンド用

| 変数名         | 説明                                  | 例                      |
| -------------- | ------------------------------------- | ----------------------- |
| `VITE_API_URL` | フロントエンドから API への URL       | `http://localhost:3000` |
| `FRONTEND_URL` | CORS 許可オリジン（API サーバー設定） | `http://localhost:5173` |

## Docker Compose 用

| 変数名              | 説明                           | デフォルト値      |
| ------------------- | ------------------------------ | ----------------- |
| `POSTGRES_USER`     | PostgreSQL ユーザー名          | `catapult`        |
| `POSTGRES_PASSWORD` | PostgreSQL パスワード          | ※必ず変更すること |
| `POSTGRES_DB`       | PostgreSQL データベース名      | `catapult`        |
| `PORT`              | API サーバーのリスニングポート | `3000`            |

## TOKEN_ENCRYPTION_KEY の生成

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## JWT_SECRET の生成

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## GitHub App のセットアップ

詳細は [docs/authentication.md](./authentication.md) を参照してください。

必要な OAuth スコープ:

- `read:user`
- `user:email`

必要な権限（将来の拡張用）:

- Contents: Read & Write（リポジトリ操作）
- Pull requests: Read & Write（PR作成）
