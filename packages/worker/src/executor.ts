import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { mkdirSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { createInterface } from "readline";

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

  // 危険なツールのブロックリスト
  private static readonly DENIED_TOOLS = ["delete_repo", "transfer_repo", "archive_repo"] as const;

  async execute(options: ExecuteOptions): Promise<void> {
    const workDir = `/tmp/copilot-jobs/${options.jobId}/workspace`;
    mkdirSync(workDir, { recursive: true });

    // git clone (トークンをURLに埋め込まず、git credential helper を使用)
    const repoUrl = `https://x-access-token:${options.githubToken}@github.com/${options.repository}.git`;
    await execAsync(`git clone --depth=1 --branch=${options.branch} ${repoUrl} .`, {
      cwd: workDir,
    });

    const homeDir = `/tmp/copilot-jobs/${options.jobId}/home`;

    if (options.mcpConfig) {
      await this.writeMcpConfig(options.mcpConfig, homeDir);
    }

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
    const configDir = `${workDir}/.copilot-cli`;
    await mkdir(configDir, { recursive: true });
    await writeFile(`${configDir}/config.json`, JSON.stringify(config, null, 2));
  }
}
