# Phase 1: プロジェクト基盤構築

## 目的

CATAPULT の開発を開始するための基盤を整備します。モノレポ構成・TypeScript 設定・Linter/Formatter・Docker 環境・データベーススキーマ・CI ワークフローを一括で構築します。

## 期間目安

**1週間**

## タスク一覧

### 1. モノレポセットアップ (npm workspaces)

```bash
# ルートの package.json 作成
npm init -y

# workspaces 設定
```

```json
// package.json
{
  "name": "catapult",
  "private": true,
  "workspaces": ["packages/*"],
  "engines": { "node": ">=22.0.0" }
}
```

各パッケージを作成:

```bash
mkdir -p packages/{api,bot,worker,frontend}/src
cd packages/api && npm init -y
cd packages/bot && npm init -y
cd packages/worker && npm init -y
cd packages/frontend && npm init -y
```

### 2. TypeScript 設定

```bash
npm install -D typescript @types/node
```

`tsconfig.base.json` を作成（`docs/tech-stack.md` 参照）。各パッケージに `tsconfig.json` を作成。

### 3. ESLint v9 Flat Config

```bash
npm install -D eslint @eslint/js typescript-eslint eslint-plugin-import eslint-config-prettier
```

`eslint.config.mjs` を作成（`docs/tech-stack.md` 参照）。

### 4. Prettier 設定

```bash
npm install -D prettier
```

`.prettierrc` と `.prettierignore` を作成。

### 5. husky + lint-staged

```bash
npm install -D husky lint-staged
npx husky init
```

`lint-staged` 設定を `package.json` に追加。`.husky/pre-commit` を設定。

### 6. Docker Compose 構成

`docker-compose.yml` を作成:

```yaml
version: "3.9"
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: catapult
      POSTGRES_USER: catapult
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  api:
    build:
      context: .
      dockerfile: docker/Dockerfile.api
    environment:
      DATABASE_URL: postgresql://catapult:${POSTGRES_PASSWORD}@postgres:5432/catapult
      REDIS_URL: redis://redis:6379
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis

  bot:
    build:
      context: .
      dockerfile: docker/Dockerfile.bot
    environment:
      REDIS_URL: redis://redis:6379
    depends_on:
      - redis
      - api

  worker:
    build:
      context: .
      dockerfile: docker/Dockerfile.worker
    environment:
      DATABASE_URL: postgresql://catapult:${POSTGRES_PASSWORD}@postgres:5432/catapult
      REDIS_URL: redis://redis:6379
    deploy:
      replicas: 2
    depends_on:
      - postgres
      - redis

  frontend:
    build:
      context: .
      dockerfile: docker/Dockerfile.frontend
    ports:
      - "80:80"
    depends_on:
      - api

volumes:
  postgres_data:
```

`docker/` ディレクトリに各 Dockerfile を作成:

- `Dockerfile.api`: Node.js 22 + API Server
- `Dockerfile.worker`: Node.js 22 + git + copilot-cli
- `Dockerfile.bot`: Node.js 22 + Bot Gateway
- `Dockerfile.frontend`: Node.js 22 (ビルド) + Nginx (サーブ)

### 7. Prisma スキーマ定義

```bash
npm install @prisma/client
npm install -D prisma
npx prisma init
```

`prisma/schema.prisma` を作成（`docs/database-schema.md` 参照）。

### 8. Prisma マイグレーション

```bash
npx prisma migrate dev --name init
npx prisma generate
```

### 9. GitHub Actions CI ワークフロー

`.github/workflows/ci.yml` を作成（`docs/tech-stack.md` 参照）。

### 10. 環境変数定義

`.env.example` を作成:

```env
# Database
DATABASE_URL=postgresql://catapult:password@localhost:5432/catapult
POSTGRES_PASSWORD=your_password_here

# Redis
REDIS_URL=redis://localhost:6379

# GitHub App
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_INSTALLATION_ID=

# Token Encryption
TOKEN_ENCRYPTION_KEY=  # 32 bytes hex (64 characters)

# Slack
SLACK_BOT_TOKEN=xoxb-
SLACK_SIGNING_SECRET=
SLACK_APP_TOKEN=xapp-

# Discord
DISCORD_BOT_TOKEN=

# API
API_BASE_URL=http://localhost:3000
JWT_SECRET=
JWT_REFRESH_SECRET=

# Frontend
VITE_API_URL=http://localhost:3000
```

### 11. README.md

プロジェクト概要・セットアップ手順・使い方を記載した `README.md` を作成。

## 成果物

- `package.json` (ルート + 各パッケージ)
- `tsconfig.base.json` + 各パッケージの `tsconfig.json`
- `eslint.config.mjs`
- `.prettierrc`, `.prettierignore`
- `.husky/pre-commit`
- `docker-compose.yml`
- `docker/Dockerfile.*`
- `prisma/schema.prisma`
- `prisma/migrations/`
- `.github/workflows/ci.yml`
- `.env.example`
- `README.md`

## 完了条件

- [ ] `npm run typecheck` がエラーなく通る
- [ ] `npm run lint` がエラーなく通る
- [ ] `npm run format:check` がエラーなく通る
- [ ] `docker compose up` で全サービスが起動する
- [ ] `npx prisma migrate deploy` でマイグレーションが適用される
- [ ] GitHub Actions CI が green になる
- [ ] コミット時に husky + lint-staged が実行される
