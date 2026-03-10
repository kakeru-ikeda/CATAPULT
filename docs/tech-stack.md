# CATAPULT - 技術スタック・Linter/Formatter 構成

## 技術スタック

| カテゴリ      | 技術・バージョン                            |
| ------------- | ------------------------------------------- |
| 言語          | TypeScript (strict)                         |
| ランタイム    | Node.js 22                                  |
| モノレポ      | npm workspaces                              |
| コンテナ      | Docker Compose                              |
| DB            | PostgreSQL 16 + Prisma                      |
| キュー        | Redis 7 + BullMQ                            |
| Bot (Slack)   | Slack Bolt SDK                              |
| Bot (Discord) | Discord.js                                  |
| 管理画面      | ReactAdmin v5                               |
| 認証          | GitHub App OAuth                            |
| CLI           | GitHub Copilot CLI (GA 2026-02-25)          |
| Linter        | ESLint v9 (Flat Config) + typescript-eslint |
| Formatter     | Prettier                                    |
| Git Hook      | husky + lint-staged                         |
| CI            | GitHub Actions                              |

## Linter 設定 (ESLint v9 Flat Config)

### 使用プラグイン

| プラグイン                  | 用途                                        |
| --------------------------- | ------------------------------------------- |
| `typescript-eslint`         | TypeScript 型チェック付きルール             |
| `eslint-plugin-import`      | import 順序の統一                           |
| `eslint-plugin-react`       | React コンポーネントルール（frontend のみ） |
| `eslint-plugin-react-hooks` | React Hooks ルール（frontend のみ）         |
| `eslint-config-prettier`    | Prettier との競合ルールを無効化             |

### `eslint.config.mjs`

```javascript
// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    plugins: {
      import: importPlugin,
    },
    rules: {
      // 未使用変数は _ プレフィックスのみ許可
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // any は原則禁止（やむを得ない場合は warn）
      "@typescript-eslint/no-explicit-any": "warn",
      // console.log は禁止（warn/error/info は許可）
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      // import 順序: builtin → external → internal → parent → sibling → index
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  prettier,
);
```

### フロントエンド向け追加設定

```javascript
// packages/frontend/eslint.config.mjs
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  // ... 共通設定を継承
  {
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off", // React 17+ では不要
    },
  },
];
```

## Formatter 設定 (Prettier)

### `.prettierrc`

```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 100,
  "endOfLine": "lf"
}
```

### `.prettierignore`

```
node_modules/
dist/
build/
coverage/
prisma/migrations/
```

## TypeScript 設定

### `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### 各パッケージの `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## Git Hook 設定 (husky + lint-staged)

### husky セットアップ

```bash
npx husky init
```

### `.husky/pre-commit`

```sh
npx lint-staged
```

### `package.json` (ルート) の lint-staged 設定

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{js,mjs,cjs,json,md,yml,yaml}": ["prettier --write"]
  }
}
```

## CI 設定 (GitHub Actions)

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  check:
    name: Typecheck, Lint, Format, Test
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Format check
        run: npm run format:check

      - name: Test
        run: npm run test
```

### `package.json` (ルート) のスクリプト

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.base.json && npm run typecheck --workspaces",
    "lint": "eslint . --ext .ts,.tsx",
    "lint:fix": "eslint . --ext .ts,.tsx --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "check": "npm run typecheck && npm run lint && npm run format:check"
  }
}
```

## モノレポ構成 (npm workspaces)

### `package.json` (ルート)

```json
{
  "name": "catapult",
  "private": true,
  "workspaces": ["packages/*"],
  "engines": {
    "node": ">=22.0.0"
  }
}
```

各パッケージは `packages/` 配下に配置し、独自の `package.json` を持ちます。

| パッケージ          | 説明                       |
| ------------------- | -------------------------- |
| `packages/api`      | Express/Fastify API Server |
| `packages/bot`      | Slack/Discord Bot Gateway  |
| `packages/worker`   | Copilot CLI Worker         |
| `packages/frontend` | ReactAdmin 管理画面        |

## テストフレームワーク (Vitest)

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

テストファイルの命名規則:

- `*.test.ts` - 単体テスト
- `*.spec.ts` - 統合テスト / E2E テスト
