# CATAPULT - 本番運用ガイド

本ドキュメントはサーバーへの初回導入から日常的な運用・保守まで、必要な手順をすべて網羅した運用マニュアルです。

---

## 目次

1. [前提要件](#1-前提要件)
2. [GitHub App の作成・設定](#2-github-app-の作成設定)
3. [Slack Bot の設定](#3-slack-bot-の設定)
4. [Discord Bot の設定](#4-discord-bot-の設定)
5. [サーバーへの導入](#5-サーバーへの導入)
6. [環境変数の設定](#6-環境変数の設定)
7. [初回起動と動作確認](#7-初回起動と動作確認)
8. [管理画面の初期設定](#8-管理画面の初期設定)
9. [ローカルエージェントの設定](#9-ローカルエージェントの設定)
10. [日常運用](#10-日常運用)
11. [トラブルシューティング](#11-トラブルシューティング)
12. [バックアップと復旧](#12-バックアップと復旧)

---

## 1. 前提要件

### サーバー要件

| 項目       | 最低スペック     | 推奨スペック     |
| ---------- | ---------------- | ---------------- |
| CPU        | 2 コア           | 4 コア以上       |
| メモリ     | 4 GB             | 8 GB 以上        |
| ストレージ | 20 GB            | 50 GB 以上       |
| OS         | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |

### 必要なソフトウェア

```bash
# Docker Engine（26 以上）
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Docker Compose Plugin（v2.x）
docker compose version   # v2.x が表示されれば OK

# Git
sudo apt-get install -y git
```

### ネットワーク要件

| ポート   | 用途                                           | 外部公開 |
| -------- | ---------------------------------------------- | -------- |
| 80 / 443 | フロントエンド（Nginx） + API リバースプロキシ | 必須     |
| 3000     | API サーバー（内部）                           | 不要     |
| 5432     | PostgreSQL（内部）                             | 非推奨   |
| 6379     | Redis（内部）                                  | 非推奨   |

外部に公開するのは **80 / 443 番ポートのみ** にしてください。
サービスのドメインは HTTPS（TLS）を必ず設定してください（GitHub OAuth コールバックに必要）。

---

## 2. GitHub App の作成・設定

CATAPULT は GitHub App の OAuth フローを使用します。PAT ではなく `ghu_` トークン（user-to-server token）で各ユーザーのリソースにアクセスします。

### 2-1. GitHub App を新規作成

1. [https://github.com/settings/apps/new](https://github.com/settings/apps/new) を開く
2. 以下のとおり設定する

| 項目                                                   | 値                                                    |
| ------------------------------------------------------ | ----------------------------------------------------- |
| GitHub App name                                        | `CATAPULT`（任意の名前）                              |
| Homepage URL                                           | `https://<your-domain>`                               |
| Callback URL                                           | `https://<your-domain>/api/auth/github/callback`      |
| Setup URL                                              | `https://<your-domain>/api/auth/github/setup`（任意） |
| Webhook                                                | 無効（Active のチェックを外す）                       |
| Expire user authorization tokens                       | **有効**（チェックを入れる）                          |
| Request user authorization (OAuth) during installation | 有効                                                  |

### 2-2. パーミッション（Permissions）設定

**Repository permissions:**

| 権限          | レベル                 |
| ------------- | ---------------------- |
| Contents      | Read & Write           |
| Pull requests | Read & Write           |
| Issues        | Read & Write           |
| Metadata      | Read（必須・変更不可） |

**Account permissions:**

| 権限            | レベル |
| --------------- | ------ |
| Email addresses | Read   |

> **注意**: Copilot CLI を実行するユーザーは `GitHub Copilot` のサブスクリプション（Individual / Business / Enterprise）を持っている必要があります。GitHub App パーミッション側での特別な設定は不要です。

### 2-3. Client ID とシークレットの取得

1. App 作成後、App のページで **Client ID** を確認してコピー
2. **Generate a new client secret** をクリックしてシークレットを生成
3. 両方を安全な場所に保存する（シークレットは一度しか表示されない）

### 2-4. App のインストール

GitHub App は、Copilot CLI でアクセスしたい **各リポジトリのオーナー**（個人 / Organization）にインストールする必要があります。

1. App ページの **Install App** タブを開く
2. 対象のアカウント・Organization を選択して **Install**
3. アクセスを許可するリポジトリを選択（`All repositories` または個別選択）

---

## 3. Slack Bot の設定

Slack を使用しない場合はこのセクションをスキップしてください。

### 3-1. Slack App を新規作成

1. [https://api.slack.com/apps](https://api.slack.com/apps) を開き、**Create New App** → **From scratch**
2. App Name（例: `CATAPULT`）とワークスペースを入力して作成

### 3-2. Socket Mode を有効化

CATAPULT の Slack Bot は **Socket Mode**（WebSocket 接続）で動作します。外部に Webhook エンドポイントを公開する必要がありません。

1. 左メニューの **Socket Mode** を開く
2. **Enable Socket Mode** をオンにする
3. Token Name（例: `catapult-socket`）を入力して **Generate** をクリック
4. 表示された `xapp-` で始まるトークンをコピー（`SLACK_APP_TOKEN`）

### 3-3. Bot Token Scopes の設定

左メニューの **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** に以下を追加:

| スコープ            | 用途                                    |
| ------------------- | --------------------------------------- |
| `app_mentions:read` | メンションイベントの受信                |
| `chat:write`        | メッセージの投稿                        |
| `chat:write.public` | チャンネルに未参加でもメッセージ投稿    |
| `im:write`          | DM の送信                               |
| `users:read`        | ユーザー情報の取得                      |
| `channels:read`     | チャンネル情報の取得                    |
| `canvases:write`    | Canvas の作成・編集（進捗・結果表示用） |
| `canvases:read`     | Canvas セクションの参照                 |

> **Canvas スコープについて**: CATAPULT は Copilot の実行結果をリッチなマークダウンで描画するために Slack Canvas を使用します。1つのスレッドに対して1つの Canvas を作成し、進捗・完了・エラーをリアルタイムに更新します。詳細は [docs/slack-canvas.md](./slack-canvas.md) を参照してください。

### 3-4. Event Subscriptions の設定

左メニューの **Event Subscriptions** を開き:

1. **Enable Events** をオンにする
2. **Subscribe to bot events** に以下を追加:
   - `app_mention`
   - `message.im`（DM 受信用）

### 3-5. Interactivity の設定

左メニューの **Interactivity & Shortcuts** を開き:

1. **Interactivity** をオンにする
2. Request URL は Socket Mode では不要（空白のまま OK）

### 3-6. App のインストールとトークン取得

1. **OAuth & Permissions** → **Install to Workspace** をクリック
2. 権限を確認して **Allow**
3. 表示された `xoxb-` で始まる **Bot User OAuth Token** をコピー（`SLACK_BOT_TOKEN`）
4. **Basic Information** → **App Credentials** → **Signing Secret** をコピー（`SLACK_SIGNING_SECRET`）

### 3-7. Bot をチャンネルに追加

Bot をメンションしたいチャンネルで `/invite @CATAPULT`（App 名）を実行してください。

---

## 4. Discord Bot の設定

Discord を使用しない場合はこのセクションをスキップしてください。

### 4-1. Discord Application を作成

1. [https://discord.com/developers/applications](https://discord.com/developers/applications) を開き、**New Application**
2. Application Name（例: `CATAPULT`）を入力して作成

### 4-2. Bot を追加

1. 左メニューの **Bot** を開く
2. **Add Bot** をクリック
3. **TOKEN** セクションの **Reset Token** → **Yes, do it!** をクリックしてトークンをコピー（`DISCORD_BOT_TOKEN`）
4. 以下の設定をオンにする:
   - **Public Bot**: OFF（サーバー限定で使用する場合）
   - **Message Content Intent**: **ON**（必須 - メンション本文の読み取りに必要）
   - **Server Members Intent**: ON（任意）
   - **Presence Intent**: OFF

> **重要**: **Message Content Intent** を有効にしないと、Bot はメンション本文を読み取れません。

### 4-3. OAuth2 スコープと Bot パーミッションの設定

左メニューの **OAuth2** → **URL Generator** を開き:

**Scopes:**

- `bot`
- `applications.commands`（スラッシュコマンドを使う場合）

**Bot Permissions:**
| パーミッション | 用途 |
| -------------- | ---- |
| Send Messages | メッセージ投稿 |
| Read Message History | スレッド返信用 |
| Use External Emojis | 絵文字使用 |
| Add Reactions | リアクション追加 |
| Embed Links | Embed メッセージ投稿 |
| Read Messages / View Channels | チャンネル読み取り |

### 4-4. Bot をサーバーに招待

1. 上記 URL Generator で生成された URL をコピー
2. ブラウザで開いてサーバーを選択し、**認証** をクリック

---

## 5. サーバーへの導入

### 5-1. リポジトリのクローン

```bash
cd /opt
sudo git clone https://github.com/<your-org>/CATAPULT.git catapult
sudo chown -R $USER:$USER catapult
cd catapult
```

### 5-2. 環境変数ファイルの作成

```bash
cp .env.example .env
```

詳細は [セクション 6](#6-環境変数の設定) を参照してください。

### 5-3. HTTPS の設定（リバースプロキシ）

本番環境では Nginx + Let's Encrypt を推奨します。Docker Compose の `frontend` コンテナ（ポート 8080）の前段に TLS を終端するリバースプロキシを配置します。

**Nginx + Certbot の例:**

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx

# ドメインの設定
sudo tee /etc/nginx/sites-available/catapult << 'EOF'
server {
    server_name <your-domain>;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # SSE（ストリーミング）のためのタイムアウト設定
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/catapult /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# TLS 証明書の取得
sudo certbot --nginx -d <your-domain>
```

### 5-4. Docker イメージのビルドと起動

```bash
cd /opt/catapult

# イメージのビルド
docker compose build

# バックグラウンドで起動
docker compose up -d

# 起動確認
docker compose ps
```

すべてのサービスが `healthy` または `running` になっていることを確認してください。

```
NAME                STATUS
catapult-postgres   healthy
catapult-redis      healthy
catapult-api        running
catapult-bot        running
catapult-worker-1   running
catapult-worker-2   running
catapult-frontend   running
```

### 5-5. データベースマイグレーション

マイグレーションは API コンテナの起動時に自動実行されます（`prisma migrate deploy`）。
手動で実行する場合:

```bash
docker compose exec api npx prisma migrate deploy
```

---

## 6. 環境変数の設定

`.env` ファイルに以下の変数を設定してください。

### 6-1. 必須変数

```env
# PostgreSQL パスワード（強力なランダム文字列を使用）
POSTGRES_PASSWORD=

# GitHub App
GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
GITHUB_APP_CLIENT_SECRET=

# トークン暗号化キー（必ず openssl で生成すること）
TOKEN_ENCRYPTION_KEY=

# JWT シークレット
JWT_SECRET=

# 公開 URL（末尾スラッシュなし）
APP_URL=https://your-domain.com
FRONTEND_URL=https://your-domain.com
```

**暗号化キーの生成:**

```bash
# TOKEN_ENCRYPTION_KEY（32 バイト = 64文字の16進数）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# JWT_SECRET（64 バイト）
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# POSTGRES_PASSWORD（32 バイト）
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 6-2. Slack Bot 変数（Slack を使用する場合）

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=
SLACK_APP_TOKEN=xapp-...
```

### 6-3. Discord Bot 変数（Discord を使用する場合）

```env
DISCORD_BOT_TOKEN=
```

### 6-4. 管理者ローカルログイン変数（オプション）

GitHub 認証なしで管理画面にアクセスするための管理者アカウントです。

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=   # 推測されにくい十分に長いランダム文字列
```

### 6-5. 変数一覧まとめ

| 変数名                     | 必須         | 説明                                    |
| -------------------------- | ------------ | --------------------------------------- |
| `POSTGRES_PASSWORD`        | ✅           | PostgreSQL パスワード                   |
| `GITHUB_APP_CLIENT_ID`     | ✅           | GitHub App の Client ID                 |
| `GITHUB_APP_CLIENT_SECRET` | ✅           | GitHub App の Client Secret             |
| `TOKEN_ENCRYPTION_KEY`     | ✅           | AES-256-GCM 暗号化キー（64 文字 hex）   |
| `JWT_SECRET`               | ✅           | JWT 署名シークレット                    |
| `APP_URL`                  | ✅           | 公開 URL（OAuth コールバックに使用）    |
| `FRONTEND_URL`             | ✅           | CORS 許可オリジン                       |
| `SLACK_BOT_TOKEN`          | Slack のみ   | `xoxb-` で始まるトークン                |
| `SLACK_SIGNING_SECRET`     | Slack のみ   | Slack Signing Secret                    |
| `SLACK_APP_TOKEN`          | Slack のみ   | `xapp-` で始まるトークン（Socket Mode） |
| `DISCORD_BOT_TOKEN`        | Discord のみ | Discord Bot Token                       |
| `ADMIN_USERNAME`           | 任意         | 管理者ユーザー名                        |
| `ADMIN_PASSWORD`           | 任意         | 管理者パスワード                        |

---

## 7. 初回起動と動作確認

### 7-1. サービス起動確認

```bash
# 全サービスの状態確認
docker compose ps

# 各サービスのログ確認
docker compose logs api
docker compose logs bot
docker compose logs worker
```

### 7-2. API ヘルスチェック

```bash
curl https://<your-domain>/api/health
# → {"status":"ok"} が返れば正常
```

### 7-3. 管理画面へのアクセス

ブラウザで `https://<your-domain>` にアクセスします。

- **GitHub でログイン**: GitHub App OAuth フローでログイン
- **ローカルログイン**: `ADMIN_USERNAME` / `ADMIN_PASSWORD` を設定している場合はパスワードでログイン

### 7-4. 最初のユーザーを管理者に設定

初回ログインしたユーザーが一般ユーザー（USER ロール）として登録されます。
管理者ロールへの昇格はデータベースから直接行います:

```bash
docker compose exec api npx prisma studio
# または psql で直接更新:
docker compose exec postgres psql -U catapult -d catapult \
  -c "UPDATE \"User\" SET role = 'ADMIN' WHERE email = 'your@email.com';"
```

### 7-5. Slack / Discord での動作テスト

1. Bot を招待したチャンネル（Slack）またはサーバー（Discord）で `@CATAPULT こんにちは` とメンション
2. GitHub アカウント未連携の場合: 「GitHub で連携する」ボタンが表示される
3. 連携済みの場合: リポジトリ選択モーダルが表示される

---

## 8. 管理画面の初期設定

### 8-1. ユーザー管理

管理画面の **Users** メニューでユーザー一覧・ロール変更・アカウント削除が行えます。

| ロール  | 権限                             |
| ------- | -------------------------------- |
| `ADMIN` | 全機能へのアクセス、ユーザー管理 |
| `USER`  | 自分のジョブ・設定のみ           |

### 8-2. MCP ツール設定

管理画面の **MCP Tools** メニューで、Copilot CLI が使用できる MCP ツールを設定します。

- **グローバル設定**: 全ユーザーに適用
- **ユーザー設定**: 個人ごとのカスタマイズ

### 8-3. インストラクション設定

管理画面の **Instructions** メニューで、Copilot CLI に渡すシステムインストラクションを設定します。

- **グローバルインストラクション**: 全ジョブに適用されるデフォルト指示
- **個人インストラクション**: ユーザーが個別に設定できる追加指示

---

## 9. ローカルエージェントの設定

ローカルエージェントは、ユーザーの **開発 PC 上に常駐するデーモン** です。サーバー上で実行する代わりに、既存の開発環境（`.env`・`node_modules`・Docker など）を使って Copilot CLI を実行できます。

### ローカルモードの価値

| タスク                    | サーバー実行 | ローカル実行 |
| ------------------------- | :----------: | :----------: |
| コードを読んで PR 作成    |      ✅      |      ✅      |
| `npm test` を実行して確認 |      ❌      |      ✅      |
| `npm run dev` で動作確認  |      ❌      |      ✅      |
| DB に接続してデータ確認   |      ❌      |      ✅      |
| Docker Compose で結合確認 |      ❌      |      ✅      |

### 9-1. 前提条件

ローカルエージェントを動かす PC に以下が必要です:

- **Node.js 22 以上**
- **GitHub Copilot CLI**（npm 経由でインストール）
- GitHub Copilot のサブスクリプション（Individual / Business / Enterprise）

GitHub Copilot CLI は npm で直接インストールできます（[公式ページ](https://github.com/features/copilot/cli?locale=ja)）:

```bash
# GitHub Copilot CLI をグローバルインストール
npm install -g @github/copilot

# バージョン確認
copilot --version
```

初回使用前に GitHub アカウントとの認証が必要です:

```bash
copilot auth login
```

ブラウザが開き、GitHub にサインインして認証を完了してください。

### 9-2. エージェントのインストール

```bash
npm install -g catapult-agent
# または npx を使う場合はインストール不要
```

> **ソースからビルドする場合:**
>
> ```bash
> cd packages/local-agent
> npm install
> npm run build
> npm link   # グローバルコマンドとして登録
> ```

### 9-3. 初期化（init）

```bash
catapult-agent init
```

対話形式で以下を入力します:

```
=== CATAPULT ローカルエージェント セットアップ ===

CATAPULT API サーバーの URL (例: https://api.catapult.example.com): https://api.your-domain.com
CATAPULT 管理画面の URL (例: https://catapult.example.com): https://your-domain.com
このマシンの名前 [MacBook-Pro]: MyLaptop
ローカルのワークスペース親フォルダ (例: ~/projects): ~/projects
```

> **注意**: API サーバー URL と管理画面 URL は別々に入力してください。同一ドメインで Nginx をリバースプロキシとして使用している場合は、どちらも同じ URL（例: `https://your-domain.com`）を入力します。

次に、**JWT トークンの取得**を求められます:

1. 管理画面（`https://your-domain.com`）をブラウザで開き、GitHub でログイン
2. ダッシュボード下部の **「🔑 ローカルエージェント用トークン」** カードを確認
3. 👁 ボタンでトークンを表示し、📋 ボタンでコピー
4. ターミナルに貼り付けて Enter

```
JWT トークン: eyJhbGci...
```

登録が成功すると以下が表示されます:

```
✅ 登録完了!
エージェント ID: clxxxxxxxxxxxxx
設定ファイル: /home/yourname/.catapult/config.json
```

設定ファイルの場所: `~/.catapult/config.json`

```json
{
  "apiUrl": "https://your-domain.com",
  "agentToken": "cat_agent_xxxxxxxxxxxx",
  "name": "MyLaptop",
  "workspaceRoot": "~/projects"
}
```

> **セキュリティ注意**: `agentToken` はサーバーへの認証情報です。このファイルを他人と共有しないでください。

### 9-4. エージェントの起動

```bash
catapult-agent start
```

起動するとハートビート（定期的な生存確認）が開始され、サーバーに対してエージェントが `ONLINE` 状態として登録されます。

### 9-5. バックグラウンド常駐（systemd の例）

Linux の場合、`systemd` でデーモン化します:

```ini
# ~/.config/systemd/user/catapult-agent.service
[Unit]
Description=CATAPULT Local Agent
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/catapult-agent start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now catapult-agent
systemctl --user status catapult-agent
```

**macOS の場合（launchd）:**

```xml
<!-- ~/Library/LaunchAgents/com.catapult.agent.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.catapult.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/catapult-agent</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/catapult-agent.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/catapult-agent-error.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.catapult.agent.plist
```

### 9-6. ローカルエージェントの使い方

エージェントが `ONLINE` の状態で Slack / Discord から `@CATAPULT` にメンションすると、リポジトリ選択後に **実行モード選択** が表示されます:

- **サーバー実行**: リモートサーバー上で実行（デフォルト）
- **ローカル実行（マシン名）**: 自分の PC 上で実行

ローカル実行を選択すると、エージェントが次のハートビート応答でジョブを受け取り、`workspaceRoot` 配下の対象リポジトリを自動検索して Copilot CLI を実行します。

### 9-7. ワークスペースの構成

`workspaceRoot` に指定したディレクトリの直下にリポジトリが配置されている必要があります:

```
~/projects/
├── myapp/           ← git clone されたリポジトリ
│   ├── .git/
│   ├── .env
│   └── ...
├── another-repo/
│   ├── .git/
│   └── ...
```

### 9-8. 複数のローカルエージェント

1 ユーザーが複数のマシン（デスクトップ・ノート PC など）でエージェントを動かすことができます。メンション時にどのマシンで実行するかを選択できます。

### 9-9. エージェントの再登録

トークンを再発行したい場合や PC を変えた場合:

```bash
# 設定ファイルを削除して再度 init
rm ~/.catapult/config.json
catapult-agent init
```

---

## 10. 日常運用

### 10-1. サービスの起動・停止

```bash
# 全サービス起動
docker compose up -d

# 全サービス停止
docker compose down

# 特定サービスのみ再起動
docker compose restart api
docker compose restart bot
docker compose restart worker

# ログ確認（リアルタイム）
docker compose logs -f api
docker compose logs -f bot
docker compose logs -f worker
```

### 10-2. アップデート手順

```bash
cd /opt/catapult

# 最新コードを取得
git pull origin main

# イメージを再ビルド
docker compose build

# ローリング再起動
docker compose up -d --no-deps api
docker compose up -d --no-deps bot
docker compose up -d --no-deps worker
docker compose up -d --no-deps frontend

# マイグレーション実行（スキーマ変更がある場合）
docker compose exec api npx prisma migrate deploy
```

### 10-3. ワーカーのスケーリング

同時実行ジョブ数を増やす場合、`docker-compose.yml` の `worker` セクションの `replicas` を変更します:

```yaml
worker:
  deploy:
    replicas: 4 # 2 → 4 に変更
```

```bash
docker compose up -d --scale worker=4
```

### 10-4. ログの管理

```bash
# 全コンテナのログサイズ確認
docker system df

# ログの削除（古いログをクリア）
docker compose logs --no-color > /opt/catapult/logs/$(date +%Y%m%d).log
docker compose down && docker compose up -d
```

Docker ログドライバーでローテーションを設定する場合は `docker-compose.yml` に追記:

```yaml
services:
  api:
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "5"
```

### 10-5. Prisma Studio（DB の GUI 確認）

```bash
docker compose exec api npx prisma studio
# → http://localhost:5555 でアクセス可能
```

---

## 11. トラブルシューティング

### Bot がメンションに反応しない

**Slack の場合:**

```bash
# Bot のログを確認
docker compose logs bot

# よくある原因:
# 1. SLACK_APP_TOKEN が未設定（Socket Mode が無効）
# 2. Bot がチャンネルに招待されていない (/invite @CATAPULT)
# 3. app_mention イベントが Subscribe to bot events に登録されていない
```

**Discord の場合:**

```bash
# よくある原因:
# 1. Message Content Intent が Developer Portal でオフになっている
# 2. Bot がサーバーに招待されていない
# 3. DISCORD_BOT_TOKEN が誤っている
```

### OAuth 認証（GitHub 連携）が失敗する

```bash
# よくある原因:
# 1. APP_URL が実際の公開 URL と一致していない
# 2. GitHub App の Callback URL が https://<your-domain>/api/auth/github/callback でない
# 3. TOKEN_ENCRYPTION_KEY が 64 文字の hex でない

# APP_URL 確認
docker compose exec api env | grep APP_URL

# コールバック確認
curl -I https://<your-domain>/api/auth/github/callback
```

### ジョブが実行されない（キューにたまる）

```bash
# Worker の状態確認
docker compose logs worker

# Redis の接続確認
docker compose exec redis redis-cli ping

# BullMQ のキュー状態確認
docker compose exec api node -e "
const { Queue } = require('bullmq');
const q = new Queue('jobs', { connection: { host: 'redis', port: 6379 } });
q.getJobCounts().then(console.log);
"
```

### ローカルエージェントが OFFLINE のまま

```bash
# エージェントのログ確認
catapult-agent start   # 直接起動してエラーを確認

# サーバーへの疎通確認
curl https://<your-domain>/api/health

# 設定ファイルの確認
cat ~/.catapult/config.json

# よくある原因:
# 1. apiUrl が間違っている
# 2. agentToken が再発行されて古くなっている
# 3. ファイアウォールで CATAPULT サーバーへの HTTPS がブロックされている
```

### データベース接続エラー

```bash
# PostgreSQL の状態確認
docker compose ps postgres

# 接続テスト
docker compose exec postgres psql -U catapult -d catapult -c "SELECT 1;"

# マイグレーション状態確認
docker compose exec api npx prisma migrate status
```

### GitHub トークンのリフレッシュエラー

GitHub App の user-to-server トークンは 8 時間で期限切れになります。自動リフレッシュが動いていない場合:

```bash
# Worker / API のログでリフレッシュエラーを確認
docker compose logs api | grep -i "refresh\|token\|expired"

# よくある原因:
# 1. TOKEN_ENCRYPTION_KEY が変更されている（古いトークンが復号できない）
# 2. GitHub App の Client Secret が再生成されている
```

> **注意**: `TOKEN_ENCRYPTION_KEY` を変更すると、既存ユーザーのトークンが全て復号不能になります。変更する場合は全ユーザーに再ログインを求める必要があります。

---

## 12. バックアップと復旧

### 12-1. PostgreSQL バックアップ

```bash
# バックアップ（圧縮形式）
docker compose exec postgres pg_dump -U catapult catapult | \
  gzip > /opt/catapult/backup/catapult-$(date +%Y%m%d-%H%M%S).sql.gz

# 自動バックアップ（cron）
# crontab -e で以下を追加:
# 0 3 * * * docker compose -f /opt/catapult/docker-compose.yml exec -T postgres \
#   pg_dump -U catapult catapult | gzip > /opt/catapult/backup/catapult-$(date +\%Y\%m\%d).sql.gz
```

### 12-2. バックアップからの復旧

```bash
# 復旧手順
docker compose down
docker compose up -d postgres

# DB を初期化して復元
docker compose exec postgres psql -U catapult -c "DROP DATABASE IF EXISTS catapult;"
docker compose exec postgres psql -U catapult -c "CREATE DATABASE catapult;"

gunzip -c /opt/catapult/backup/catapult-20260314.sql.gz | \
  docker compose exec -T postgres psql -U catapult catapult

# 残りのサービスを起動
docker compose up -d
```

### 12-3. .env ファイルのバックアップ

`.env` ファイルは **暗号化して** 安全な場所に保存してください。

```bash
# GPG で暗号化して保存
gpg --symmetric --cipher-algo AES256 /opt/catapult/.env
# → .env.gpg が生成される
```

> **重要**: `TOKEN_ENCRYPTION_KEY` と `JWT_SECRET` は特に厳重に管理してください。これらを失うと、DB 内のトークンは永久に復号不能になります。

---

## 付録

### サービス構成図

```
外部 (HTTPS)
     │
     ▼
[Nginx / リバースプロキシ]
     │ :80/:443
     ▼
[Docker Compose ネットワーク]
     │
     ├─ frontend:8080 ─ ReactAdmin 管理画面
     │
     ├─ api:3000      ─ REST API / OAuth / SSE
     │       │
     │       ├─ [PostgreSQL:5432]
     │       └─ [Redis:6379]
     │
     ├─ bot           ─ Slack / Discord Bot Gateway
     │       │
     │       └─ [Redis Pub/Sub]
     │
     └─ worker x2     ─ Copilot CLI 実行ワーカー
             │
             └─ [BullMQ / Redis]
```

### ポートマッピング

| ホストポート | サービス | 説明                               |
| ------------ | -------- | ---------------------------------- |
| 8080         | frontend | 管理画面・API プロキシ（Nginx）    |
| 3000         | api      | API サーバー（必要な場合のみ開放） |
| 5432         | postgres | DB（外部開放非推奨）               |
| 6379         | redis    | Redis（外部開放非推奨）            |

### 関連ドキュメント

| ドキュメント                                    | 内容                       |
| ----------------------------------------------- | -------------------------- |
| [docs/architecture.md](./architecture.md)       | システムアーキテクチャ詳細 |
| [docs/authentication.md](./authentication.md)   | GitHub OAuth フロー        |
| [docs/env-variables.md](./env-variables.md)     | 環境変数リファレンス       |
| [docs/local-agent.md](./local-agent.md)         | ローカルエージェント設計   |
| [docs/database-schema.md](./database-schema.md) | DB スキーマ                |
| [docs/streaming.md](./streaming.md)             | SSE ストリーミング設計     |
