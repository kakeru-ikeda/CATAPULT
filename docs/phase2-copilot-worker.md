# Phase 2: Copilot CLI Worker 実装

## 目的

GitHub Copilot CLI を実行し、NDJSON 形式の出力をリアルタイムで配信するワーカーを実装します。BullMQ によるジョブキューと連携し、並列処理・キャンセル・クリーンアップを実現します。

## 期間目安

**1週間**

## タスク一覧

### 1. CopilotExecutor クラス実装

`packages/worker/src/executor.ts` を実装:

```typescript
import { createInterface } from "readline";
import { EventEmitter } from "events";
import { spawn, ChildProcess } from "child_process";
import { mkdirSync } from "fs";
import { execAsync } from "./utils";

export interface CopilotEvent {
  type: "agent_step" | "tool_call" | "shell" | "file_edit" | "thinking" | "error" | "done";
  content?: string;
  tool?: string;
  input?: unknown;
  command?: string;
  stdout?: string;
  stderr?: string;
  path?: string;
  diff?: string;
  message?: string;
  summary?: string;
  prUrl?: string;
}

export interface ExecuteOptions {
  jobId: string;
  prompt: string;
  repository: string; // "owner/repo"
  branch: string;
  githubToken: string;
  mcpConfig?: object;
  instructions?: string;
}

export class CopilotExecutor extends EventEmitter {
  private proc: ChildProcess | null = null;

  async execute(options: ExecuteOptions): Promise<void> {
    // 作業ディレクトリ作成
    const workDir = `/tmp/copilot-jobs/${options.jobId}/workspace`;
    mkdirSync(workDir, { recursive: true });

    // git clone
    const repoUrl = `https://x-access-token:${options.githubToken}@github.com/${options.repository}.git`;
    await execAsync(`git clone --depth=1 --branch=${options.branch} ${repoUrl} .`, {
      cwd: workDir,
    });

    // MCP 設定ファイル生成
    if (options.mcpConfig) {
      await this.writeMcpConfig(options.mcpConfig, workDir);
    }

    // インストラクション注入（ブランチ名にジョブ ID を含める指示）
    const fullPrompt = this.buildPrompt(options);

    // Copilot CLI 実行
    this.proc = spawn(
      "copilot",
      ["--autopilot", "--allow-all", "--output", "json", "-p", fullPrompt],
      {
        cwd: workDir,
        env: {
          ...process.env,
          GITHUB_TOKEN: options.githubToken,
          HOME: `/tmp/copilot-jobs/${options.jobId}/home`,
        },
      },
    );

    const rl = createInterface({ input: this.proc.stdout! });

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as CopilotEvent;
        this.emit("event", event);
      } catch {
        // パースエラーは無視
      }
    });

    return new Promise((resolve, reject) => {
      this.proc!.on("exit", (code) => {
        if (code === 0 || code === null) resolve();
        else reject(new Error(`Copilot CLI exited with code ${code}`));
      });
      this.proc!.on("error", reject);
    });
  }

  cancel(): void {
    this.proc?.kill("SIGTERM");
  }

  private buildPrompt(options: ExecuteOptions): string {
    const jobShortId = options.jobId.slice(-8);
    const branchInstruction = `
## 重要: ブランチ名の形式
作業ブランチを作成する際は、必ず以下の形式を使用してください:
  copilot/job-${jobShortId}/<機能名>
例: copilot/job-${jobShortId}/fix-login-bug
`;
    return [branchInstruction, options.instructions ?? "", options.prompt]
      .filter(Boolean)
      .join("\n\n");
  }

  private async writeMcpConfig(config: object, workDir: string): Promise<void> {
    const { writeFile, mkdir } = await import("fs/promises");
    const configDir = `${workDir}/.copilot-cli`;
    await mkdir(configDir, { recursive: true });
    await writeFile(`${configDir}/config.json`, JSON.stringify(config, null, 2));
  }
}
```

### 2. NDJSON パーサー (output-parser.ts)

```typescript
// packages/worker/src/output-parser.ts

export function parseCopilotEvent(line: string): CopilotEvent | null {
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed.type !== "string") return null;
    return parsed as CopilotEvent;
  } catch {
    return null;
  }
}

export function extractPrUrl(events: CopilotEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === "done" && event.prUrl) return event.prUrl;
    // stdout からも PR URL を抽出
    if (event.type === "shell" && event.stdout) {
      const match = event.stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
      if (match) return match[0];
    }
  }
  return undefined;
}
```

### 3. BullMQ Worker (job-processor.ts)

```typescript
// packages/worker/src/job-processor.ts

import { Worker, Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { CopilotExecutor } from "./executor";
import { decrypt } from "./token-vault";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL!);

export const worker = new Worker(
  "jobs",
  async (job: Job) => {
    const { jobId } = job.data as { jobId: string };

    // DB からジョブ情報を取得
    const dbJob = await prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      include: { user: true },
    });

    // ジョブを RUNNING 状態に更新
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    const executor = new CopilotExecutor();
    const events: CopilotEvent[] = [];

    executor.on("event", async (event: CopilotEvent) => {
      events.push(event);

      // thinking イベントは配信・保存しない
      if (event.type === "thinking") return;

      // Redis Pub/Sub に配信
      await redis.publish(`job:${jobId}`, JSON.stringify(event));

      // JobLog テーブルに保存
      await prisma.jobLog.create({
        data: {
          jobId,
          eventType: event.type,
          content: JSON.stringify(event),
        },
      });
    });

    // キャンセルシグナルの監視
    job.updateProgress(0);

    try {
      // トークン取得（自動リフレッシュ）
      const githubToken = await refreshTokenIfNeeded(dbJob.userId);

      // MCP ツール設定と個人インストラクション取得
      const [mcpTools, instructions] = await Promise.all([
        getMcpConfig(dbJob.userId),
        getActiveInstructions(dbJob.userId),
      ]);

      await executor.execute({
        jobId,
        prompt: dbJob.prompt,
        repository: dbJob.repository,
        branch: dbJob.branch,
        githubToken,
        mcpConfig: mcpTools,
        instructions,
      });

      // PR URL の抽出
      const prUrl = extractPrUrl(events);

      // 完了
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          prUrl,
          resultSummary: events.find((e) => e.type === "done")?.summary,
        },
      });
    } catch (error) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "FAILED", completedAt: new Date() },
      });
      throw error;
    } finally {
      // 作業ディレクトリのクリーンアップ
      await cleanupWorkDir(jobId);
    }
  },
  {
    connection: redis,
    concurrency: 3,
  },
);
```

### 4. TokenVault (AES-256-GCM 暗号化)

`packages/worker/src/token-vault.ts` を実装（`docs/authentication.md` 参照）。

### 5. TokenRefresher (分散ロック付き)

`packages/api/src/services/token-refresher.ts` を実装（`docs/authentication.md` 参照）。

### 6. sandbox.ts (作業ディレクトリ管理)

```typescript
// packages/worker/src/sandbox.ts

import { mkdirSync } from "fs";
import { rm } from "fs/promises";

export function createWorkDir(jobId: string): string {
  const workDir = `/tmp/copilot-jobs/${jobId}/workspace`;
  mkdirSync(workDir, { recursive: true });
  return workDir;
}

export async function cleanupWorkDir(jobId: string): Promise<void> {
  const dir = `/tmp/copilot-jobs/${jobId}`;
  await rm(dir, { recursive: true, force: true });
}
```

## 成果物

- `packages/worker/src/executor.ts` - CopilotExecutor クラス
- `packages/worker/src/output-parser.ts` - NDJSON パーサー・PR URL 抽出
- `packages/worker/src/job-processor.ts` - BullMQ Worker
- `packages/worker/src/sandbox.ts` - 作業ディレクトリ管理
- `packages/worker/src/token-vault.ts` - トークン暗号化
- `packages/api/src/services/token-refresher.ts` - トークン自動リフレッシュ
- `packages/worker/src/index.ts` - エントリーポイント

## 完了条件

- [ ] `copilot --autopilot --allow-all --output json -p` でプロセスが起動する
- [ ] NDJSON イベントが正しくパースされる
- [ ] `thinking` イベントが DB に保存されない・Pub/Sub に配信されない
- [ ] ジョブ完了時に PR URL が抽出される
- [ ] プロセスキャンセル (`SIGTERM`) が正しく動作する
- [ ] 作業ディレクトリが完了後にクリーンアップされる
- [ ] トークン自動リフレッシュが分散ロック付きで動作する
- [ ] Worker の同時実行数が 3 に制限される
