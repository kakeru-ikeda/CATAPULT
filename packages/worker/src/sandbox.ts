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
