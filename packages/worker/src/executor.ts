import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { mkdirSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { createInterface } from "readline";

import { buildPrompt, type CopilotEvent, type ExecuteOptions } from "@catapult/core";

import { deploySkills } from "./skill-deployer.js";
import { execAsync } from "./utils.js";

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

    const fullPrompt = buildPrompt(options);

    const modelArgs = options.model ? ["--model", options.model] : [];

    this.proc = spawn(
      "copilot",
      [
        "--autopilot",
        "--allow-all",
        "--output-format",
        "json",
        ...modelArgs,
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

  private async writeMcpConfig(config: object, workDir: string): Promise<void> {
    const configDir = `${workDir}/.copilot-cli`;
    await mkdir(configDir, { recursive: true });
    await writeFile(`${configDir}/config.json`, JSON.stringify(config, null, 2));
  }
}

/**
 * ジョブのワーキングディレクトリで `git rev-parse` を実行し、
 * Autopilot が実際にチェックアウトしているブランチ名を取得する。
 * extractWorkerBranch がイベントから拾えなかった場合のフォールバック。
 */
export async function detectBranchFromWorkDir(jobId: string): Promise<string | undefined> {
  const workDir = `/tmp/copilot-jobs/${jobId}/workspace`;
  try {
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: workDir });
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}
