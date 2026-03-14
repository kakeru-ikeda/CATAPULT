import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { createInterface } from "readline";

import { EventReporter } from "./event-reporter.js";

export type DeliverableType = "pr" | "report" | "commit_only" | "review";

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

export interface LocalExecuteOptions {
  jobId: string;
  workDir: string; // ローカルリポジトリの絶対パス
  prompt: string;
  repository: string;
  branch: string;
  githubToken: string;
  deliverableType: DeliverableType;
}

export class LocalCopilotExecutor extends EventEmitter {
  private proc: ChildProcess | null = null;

  private static readonly DENIED_TOOLS = ["delete_repo", "transfer_repo", "archive_repo"] as const;

  async execute(options: LocalExecuteOptions, reporter: EventReporter): Promise<void> {
    const { jobId, workDir, repository, branch, githubToken, deliverableType } = options;

    const denyArgs = LocalCopilotExecutor.DENIED_TOOLS.flatMap((t) => ["--deny-tool", t]);
    const fullPrompt = this.buildPrompt(options);

    const args = [
      "--autopilot",
      "--allow-all",
      "--output-format",
      "json",
      "-p",
      fullPrompt,
      ...denyArgs,
    ];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GITHUB_TOKEN: githubToken,
      GH_TOKEN: githubToken,
    };

    console.info(`[executor] Starting copilot-agent in ${workDir} for job ${jobId}`);
    console.info(
      `[executor] Repository: ${repository}, Branch: ${branch}, Deliverable: ${deliverableType}`,
    );

    this.proc = spawn("copilot", args, {
      cwd: workDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    const rl = createInterface({ input: this.proc.stdout! });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed) as { type?: string; [key: string]: unknown };
        // workerと同じ形式で報告: copilotのrawイベントフィールドを保持
        // (data: event で包むと event.data?.toolName が undefined になる)
        reporter.report({
          ...event,
          type: event.type ?? "message",
          timestamp: new Date().toISOString(),
        } as import("./event-reporter.js").JobEvent);
        this.emit("event", event);
      } catch {
        reporter.report({
          type: "message",
          data: { content: trimmed },
          timestamp: new Date().toISOString(),
        });
      }
    });

    const stderrLines: string[] = [];
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrLines.push(text);
      console.error("[copilot stderr]", text.trimEnd());
      // stderr もイベントとして報告する
      reporter.report({
        type: "stderr",
        data: { content: text.trimEnd() },
        timestamp: new Date().toISOString(),
      });
    });

    // 起動後 10 秒以内に stdout/stderr の出力がない場合はタイムアウトエラー
    let firstOutputReceived = false;
    const startupTimeout = setTimeout(() => {
      if (!firstOutputReceived) {
        const stderrSummary = stderrLines.join("").slice(0, 500);
        this.proc?.kill("SIGTERM");
        console.error("[executor] copilot process produced no output within 10s");
        if (stderrSummary) console.error("[executor] stderr:", stderrSummary);
      }
    }, 10_000);

    rl.on("line", () => {
      firstOutputReceived = true;
    });
    this.proc.stderr?.on("data", () => {
      firstOutputReceived = true;
    });

    return new Promise((resolve, reject) => {
      this.proc!.on("exit", (code) => {
        clearTimeout(startupTimeout);
        if (code === 0) {
          resolve();
        } else {
          const stderr = stderrLines.join("").slice(0, 500);
          reject(new Error(`copilot exited with code ${code}: ${stderr}`));
        }
      });
      this.proc!.on("error", (err) => {
        clearTimeout(startupTimeout);
        reject(err);
      });
    });
  }

  cancel(): void {
    this.proc?.kill("SIGTERM");
  }

  private buildPrompt(options: LocalExecuteOptions): string {
    const jobShortId = options.jobId.slice(-8);
    const branchInstruction =
      options.repository && options.branch
        ? `## 重要: ブランチ名の形式
作業ブランチを作成する際は、必ず以下の形式を使用してください:
  copilot/job-${jobShortId}/<機能名>
例: copilot/job-${jobShortId}/fix-login-bug`
        : "";
    const deliverableInstruction =
      options.deliverableType === "pr" && options.repository
        ? `## 出力形式: PR 作成
変更をブランチにコミット・プッシュし、\`${options.repository}\` リポジトリにプルリクエストを作成してください。`
        : DELIVERABLE_INSTRUCTIONS[options.deliverableType];

    return [deliverableInstruction, branchInstruction, options.prompt].filter(Boolean).join("\n\n");
  }
}
