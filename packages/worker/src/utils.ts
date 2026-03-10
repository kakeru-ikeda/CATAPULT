import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

export async function execAsync(
  command: string,
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  const result = await execPromise(command, { ...options, encoding: "utf8" });
  return { stdout: result.stdout, stderr: result.stderr };
}
