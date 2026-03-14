# catapult-agent

CATAPULT ローカルエージェント — ローカル開発環境で GitHub Copilot CLI ジョブを実行する常駐デーモンです。

> **親プロジェクト**: [kakeru-ikeda/CATAPULT](https://github.com/kakeru-ikeda/CATAPULT)

## 概要

通常の CATAPULT はサーバー上でリポジトリを `git clone` した空の環境で動作するため、テスト実行・DB 接続・Docker Compose を使った動作確認などは実行できません。

`catapult-agent` をローカル PC にインストールして起動することで、**既存の開発環境（`.env`・`node_modules`・起動済み Docker コンテナ）をそのまま使って**ジョブを実行できます。

```
Slack/Discord でメンション
    ↓
CATAPULT サーバーがジョブを作成
    ↓
catapult-agent (ローカル PC) がジョブを受け取る
    ↓
ローカルリポジトリで Copilot CLI を実行
    ↓
結果をリアルタイムでスレッドに投稿
```

## 必要条件

- **Node.js 22 以上**
- **GitHub Copilot CLI** (`npm install -g @github/copilot` でインストール済み)
- **CATAPULT サーバー**（接続先として使用）

## インストール

```bash
npm install -g catapult-agent
```

または `npx` で直接実行:

```bash
npx catapult-agent init
```

## セットアップ

### 1. 初期化

```bash
catapult-agent init
```

対話形式で以下の情報を入力します:

| 入力項目                  | 説明                                                                 | 例                                 |
| ------------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| CATAPULT API サーバー URL | CATAPULT API サーバーのベース URL                                    | `https://api.catapult.example.com` |
| CATAPULT 管理画面 URL     | ブラウザでアクセスする管理画面の URL                                 | `https://catapult.example.com`     |
| マシン名                  | Slack/Discord のモーダルで表示される識別名（省略で hostname を使用） | `MacBook Pro`                      |
| ワークスペース親フォルダ  | ローカルリポジトリが格納されているフォルダ                           | `~/projects`                       |
| JWT トークン              | CATAPULT 管理画面からコピーした認証トークン                          |                                    |

JWT トークンの取得方法:

1. CATAPULT 管理画面（フロントエンド）に Web ブラウザでアクセス（API サーバー URL ではない）
2. GitHub でログイン
3. ダッシュボード下部の **"🔑 ローカルエージェント用トークン"** カードでトークンをコピー

設定は `~/.catapult/config.json` に保存されます。

### 2. 起動

```bash
catapult-agent start
```

エージェントが起動し、30 秒ごとにサーバーにハートビートを送信します。Slack/Discord でローカル実行を選択すると、このエージェントがジョブを受け取って実行します。

### バックグラウンドで起動する場合

```bash
# pm2 を使う場合
npm install -g pm2
pm2 start catapult-agent -- start
pm2 save
pm2 startup
```

## ワークスペースの解決

`workspaceRoot` 配下のディレクトリを再帰的にスキャンし、`.git/config` の `remote.origin.url` からジョブのリポジトリ（例: `owner/repo`）に一致するローカルパスを自動解決します。

例: `workspaceRoot = ~/projects` で `owner/myapp` のジョブが来た場合:

- `~/projects/myapp/.git/config` の origin が `github.com/owner/myapp` に一致 → 実行パスとして使用

## コマンド一覧

| コマンド                | 説明                                 |
| ----------------------- | ------------------------------------ |
| `catapult-agent init`   | 初期化・サーバーへのエージェント登録 |
| `catapult-agent start`  | エージェントデーモンを起動           |
| `catapult-agent --help` | ヘルプを表示                         |

## 設定ファイル

`~/.catapult/config.json`:

```json
{
  "apiUrl": "https://catapult.example.com",
  "agentToken": "<エージェントトークン>",
  "name": "MacBook Pro",
  "workspaceRoot": "~/projects"
}
```

## セキュリティ

- エージェントトークンはサーバー登録時に発行される一意のトークンです
- JWT トークンはサーバー登録にのみ使用され、設定ファイルには保存されません
- ジョブ実行時に使用する GitHub トークンはサーバーから暗号化された状態で受け取ります

## ライセンス

MIT
