import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { createInterface } from "readline";

import { EventReporter } from "./event-reporter.js";

export interface LocalExecuteOptions {
  jobId: string;
  workDir: string; // ローカルリポジトリの絶対パス
  prompt: string;
  repository: string;
  branch: string;
  githubToken: string;
}

export class LocalCopilotExecutor extends EventEmitter {
  private proc: ChildProcess | null = null;

  private static readonly DENIED_TOOLS = ["delete_repo", "transfer_repo", "archive_repo"] as const;

  async execute(options: LocalExecuteOptions, reporter: EventReporter): Promise<void> {
    const { jobId, workDir, prompt, repository, branch, githubToken } = options;

    const denyArgs = LocalCopilotExecutor.DENIED_TOOLS.flatMap((t) => ["--deny-tool", t]);

    const args = [
      "--autopilot",
      "--allow-all",
      "--output-format",
      "json",
      "-p",
      prompt,
      ...denyArgs,
    ];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GITHUB_TOKEN: githubToken,
      GH_TOKEN: githubToken,
    };

    console.info(`[executor] Starting copilot-agent in ${workDir} for job ${jobId}`);
    console.info(`[executor] Repository: ${repository}, Branch: ${branch}`);

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
}
