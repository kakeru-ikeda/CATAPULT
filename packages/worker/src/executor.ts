import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { mkdirSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { createInterface } from "readline";

import { deploySkills } from "./skill-deployer.js";
import { execAsync } from "./utils.js";

export interface CopilotEvent {
  type: string;
  // New Copilot CLI v1.x format fields
  data?: {
    content?: string;
    toolName?: string;
    arguments?: unknown;
    success?: boolean;
    result?: { content?: string; detailedContent?: string };
    toolRequests?: Array<{ name: string; arguments: unknown; toolCallId: string; type?: string }>;
    [key: string]: unknown;
  };
  exitCode?: number;
  // Legacy format fields
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

export type DeliverableType = "pr" | "report" | "commit_only" | "review";

const SENDABLE_MESSAGE_INSTRUCTION = `## 重要: 最終メッセージの形式
最後の assistant.message には、Slack / Discord にそのまま送れる完了報告を必ず含めてください。
末尾に必ず次のセクションを追加し、このセクション単体で送信文として完結させてください。

## 送信用メッセージ
- 日本語で簡潔かつ自然にまとめる
- 実施したこと、主要な変更点、確認したテスト結果を含める
- PR URL や「以上です」のような冗長な締めは含めない
- 2〜5文程度で、進捗説明ではなく完了報告として書く
`;

const DELIVERABLE_INSTRUCTIONS: Record<DeliverableType, string> = {
  pr: "",
  report: `## 出力形式: 調査・報告
コードの変更・コミット・プッシュ・PR作成は行わないでください。
以下のタスクについて調査し、結果をまとめて出力してください。

`,
  commit_only: `## 出力形式: コミットのみ
変更をブランチにコミット・プッシュしてください。
プルリクエストは作成しないでください。

`,
  review: `## 出力形式: コードレビュー
コードを変更・コミット・プッシュしないでください。
既存のコードをレビューし、改善点・問題点・良い点を整理して出力してください。

`,
};

export interface ExecuteOptions {
  jobId: string;
  userId: string;
  prompt: string;
  repository: string; // "owner/repo"
  branch: string;
  githubToken: string;
  mcpConfig?: object;
  instructions?: string;
  previousContext?: string; // 前回ジョブのサマリー（軽量セッション）
  deliverableType?: DeliverableType;
}

export class CopilotExecutor extends EventEmitter {
  private proc: ChildProcess | null = null;

  // 危険なツールのブロックリスト
  private static readonly DENIED_TOOLS = ["delete_repo", "transfer_repo", "archive_repo"] as const;

  async execute(options: ExecuteOptions): Promise<void> {
    const workDir = `/tmp/copilot-jobs/${options.jobId}/workspace`;
    mkdirSync(workDir, { recursive: true });

    // git clone (リポジトリが指定されている場合のみ)
    if (options.repository) {
      console.info(`[Job ${options.jobId}] Cloning ${options.repository}@${options.branch}...`);
      const repoUrl = `https://x-access-token:${options.githubToken}@github.com/${options.repository}.git`;
      await execAsync(`git clone --depth=1 --branch=${options.branch} ${repoUrl} .`, {
        cwd: workDir,
      });
      console.info(`[Job ${options.jobId}] Clone complete`);
    }

    const homeDir = `/tmp/copilot-jobs/${options.jobId}/home`;

    if (options.mcpConfig) {
      await this.writeMcpConfig(options.mcpConfig, homeDir);
    }

    await deploySkills(options.userId, homeDir);

    const fullPrompt = this.buildPrompt(options);

    this.proc = spawn(
      "copilot",
      [
        "--autopilot",
        "--allow-all",
        "--output-format",
        "json",
        ...CopilotExecutor.DENIED_TOOLS.flatMap((tool) => ["--deny-tool", tool]),
        "-p",
        fullPrompt,
      ],
      {
        cwd: workDir,
        env: {
          ...process.env,
          GITHUB_TOKEN: options.githubToken,
          GH_TOKEN: options.githubToken,
          HOME: homeDir,
        },
      },
    );

    console.info(`[Job ${options.jobId}] Copilot CLI spawned (PID: ${this.proc.pid})`);

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

    const stderrLines: string[] = [];
    this.proc.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrLines.push(text);
      console.error("[copilot stderr]", text.trimEnd());
    });

    return new Promise<void>((resolve, reject) => {
      this.proc!.on("exit", (code) => {
        if (code === 0 || code === null) resolve();
        else {
          const detail = stderrLines.join("").slice(0, 500);
          reject(new Error(`Copilot CLI exited with code ${code}${detail ? `: ${detail}` : ""}`));
        }
      });
      this.proc!.on("error", reject);
    });
  }

  cancel(): void {
    this.proc?.kill("SIGTERM");
  }

  private buildPrompt(options: ExecuteOptions): string {
    const jobShortId = options.jobId.slice(-8);
    const branchInstruction = options.repository
      ? `
## 重要: ブランチ名の形式
作業ブランチを作成する際は、必ず以下の形式を使用してください:
  copilot/job-${jobShortId}/<機能名>
例: copilot/job-${jobShortId}/fix-login-bug
`
      : "";
    const previousContextSection = options.previousContext
      ? `## 前回の作業サマリー\n${options.previousContext}`
      : "";
    const deliverableType = options.deliverableType ?? "pr";
    const deliverableInstruction =
      deliverableType === "pr" && options.repository
        ? `## 出力形式: PR 作成\n変更をブランチにコミット・プッシュし、\`${options.repository}\` リポジトリにプルリクエストを作成してください。\n`
        : DELIVERABLE_INSTRUCTIONS[deliverableType];
    return [
      deliverableInstruction,
      branchInstruction,
      SENDABLE_MESSAGE_INSTRUCTION,
      options.instructions ?? "",
      previousContextSection,
      options.prompt,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private async writeMcpConfig(config: object, workDir: string): Promise<void> {
    const configDir = `${workDir}/.copilot-cli`;
    await mkdir(configDir, { recursive: true });
    await writeFile(`${configDir}/config.json`, JSON.stringify(config, null, 2));
  }
}
