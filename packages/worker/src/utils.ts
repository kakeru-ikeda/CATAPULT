import { execFile } from "child_process";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);
const execFileAsync = promisify(execFile);

export async function execAsync(
  command: string,
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  const result = await execPromise(command, { ...options, encoding: "utf8" });
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * copilot --help の出力から --model の choices を抽出して返す
 */
export async function parseAvailableModels(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("copilot", ["--help"]);
    // --model セクションから choices: "..." を抽出
    const section = stdout.match(/--model <model>.*?(?=\n {2}--|$)/s)?.[0] ?? "";
    const models = [...section.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    return models;
  } catch {
    return [];
  }
}
