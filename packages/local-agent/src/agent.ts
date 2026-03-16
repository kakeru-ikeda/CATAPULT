import { exec } from "child_process";
import { promisify } from "util";

import { sanitizeSummary } from "@catapult/core";

import type { AgentConfig } from "./config.js";
import { EventReporter } from "./event-reporter.js";
import { LocalCopilotExecutor } from "./executor.js";
import { resolveWorkspacePath } from "./workspace-resolver.js";

const execAsync = promisify(exec);

interface HeartbeatResponse {
  status: "ok";
  pendingJobId: string | null;
}

interface ClaimJobResponse {
  jobId: string;
  repository: string;
  branch: string;
  prompt: string;
  githubToken: string;
  branchMode?: "new" | "existing";
  deliverableType?: "pr" | "report" | "commit_only" | "review";
  instructions?: string | null;
  conversationHistory?: Array<{ prompt: string; summary: string; prUrl?: string }>;
}

interface CompleteJobRequest {
  status: "COMPLETED" | "FAILED";
  error?: string;
  summary?: string;
  prUrl?: string;
}

interface FallbackRequest {
  reason: string;
}

async function sendHeartbeat(config: AgentConfig): Promise<HeartbeatResponse> {
  const res = await fetch(`${config.apiUrl}/api/agents/heartbeat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.agentToken}` },
  });
  if (!res.ok) throw new Error(`Heartbeat failed: ${res.status}`);
  return res.json() as Promise<HeartbeatResponse>;
}

async function claimJob(config: AgentConfig): Promise<ClaimJobResponse | null> {
  const res = await fetch(`${config.apiUrl}/api/agents/jobs/claim`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.agentToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Claim job failed: ${res.status}`);
  return res.json() as Promise<ClaimJobResponse>;
}

async function completeJob(
  config: AgentConfig,
  jobId: string,
  body: CompleteJobRequest,
): Promise<void> {
  await fetch(`${config.apiUrl}/api/agents/jobs/${jobId}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.agentToken}`,
    },
    body: JSON.stringify(body),
  });
}

async function fallbackJob(
  config: AgentConfig,
  jobId: string,
  body: FallbackRequest,
): Promise<void> {
  await fetch(`${config.apiUrl}/api/agents/jobs/${jobId}/fallback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.agentToken}`,
    },
    body: JSON.stringify(body),
  });
}

async function runJob(config: AgentConfig, jobId: string): Promise<void> {
  const job = await claimJob(config);
  if (!job || job.jobId !== jobId) {
    console.warn(`[agent] Job ${jobId} could not be claimed`);
    return;
  }

  console.info(`[agent] Claimed job ${job.jobId}: ${job.repository}@${job.branch}`);

  // ローカルリポジトリを解決
  const workDir = resolveWorkspacePath(config.workspaceRoot, job.repository);
  if (!workDir) {
    console.warn(`[agent] Repository ${job.repository} not found locally, requesting fallback`);
    await fallbackJob(config, job.jobId, {
      reason: `Repository ${job.repository} not found in ${config.workspaceRoot}`,
    });
    return;
  }

  console.info(`[agent] Using workspace: ${workDir}`);

  // 指定ブランチに切り替え（workerBranch が設定されている場合はそのブランチで継続）
  try {
    await execAsync(`git -C "${workDir}" checkout "${job.branch}"`);
    console.info(`[agent] Checked out branch: ${job.branch}`);
  } catch {
    console.warn(`[agent] Could not checkout ${job.branch}, using current branch`);
  }

  const reporter = new EventReporter(job.jobId, config);
  const executor = new LocalCopilotExecutor();
  let summary: string | undefined;

  try {
    await executor.execute(
      {
        jobId: job.jobId,
        workDir,
        userId: "local-agent", // dummy
        prompt: job.prompt,
        repository: job.repository,
        branch: job.branch,
        githubToken: job.githubToken,
        branchMode: job.branchMode,
        deliverableType: job.deliverableType as "pr" | "report" | "commit_only" | "review",
        instructions: job.instructions ?? undefined,
        conversationHistory: job.conversationHistory,
      },
      reporter,
    );

    await reporter.flush();

    // CATAPULT_SUMMARY.md の読み取り
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const summaryPath = path.join(workDir, "CATAPULT_SUMMARY.md");
      summary = sanitizeSummary(await fs.readFile(summaryPath, "utf-8"));

      // Cleanup
      await fs.rm(summaryPath, { force: true });
    } catch {
      console.warn(`[Job ${job.jobId}] CAUTION: CATAPULT_SUMMARY.md not found in ${workDir}.`);
    }

    await completeJob(config, job.jobId, { status: "COMPLETED", summary });
    console.info(`[agent] Job ${job.jobId} completed`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Job ${job.jobId} failed:`, errorMsg);
    reporter.report({
      type: "error",
      data: { content: errorMsg },
      timestamp: new Date().toISOString(),
    });
    await reporter.flush();
    await completeJob(config, job.jobId, { status: "FAILED", error: errorMsg });
  }
}

export async function startMainLoop(config: AgentConfig): Promise<void> {
  const HEARTBEAT_INTERVAL_MS = 30_000;

  console.info(`[agent] Starting local agent: ${config.name}`);
  console.info(`[agent] API URL: ${config.apiUrl}`);
  console.info(`[agent] Workspace root: ${config.workspaceRoot}`);

  let currentJobId: string | null = null;

  const heartbeat = async (): Promise<void> => {
    try {
      const res = await sendHeartbeat(config);
      if (res.pendingJobId && !currentJobId) {
        currentJobId = res.pendingJobId;
        void runJob(config, res.pendingJobId).finally(() => {
          currentJobId = null;
        });
      }
    } catch (err) {
      console.warn("[agent] Heartbeat error:", err);
    }
  };

  // 初回即時実行
  await heartbeat();

  const heartbeatTimer = setInterval(() => {
    void heartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  const shutdown = (): void => {
    console.info("[agent] Shutting down...");
    clearInterval(heartbeatTimer);
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
