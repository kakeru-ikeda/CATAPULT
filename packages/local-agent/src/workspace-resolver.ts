import { readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  ".npm",
  ".yarn",
  "vendor",
  "__pycache__",
  ".venv",
]);

const MAX_DEPTH = 4;

/**
 * .git/config から remote "origin" の URL を取得する
 */
function getRemoteOriginUrl(gitConfigPath: string): string | null {
  try {
    const content = readFileSync(gitConfigPath, "utf8");
    const match = content.match(/\[remote "origin"\][^[\]]*url\s*=\s*(.+)/u);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/**
 * リモート URL が "owner/repo" にマッチするか判定
 */
function matchesRepository(remoteUrl: string, repository: string): boolean {
  const patterns = [
    `github.com/${repository}`,
    `github.com:${repository}`,
    `github.com/${repository}.git`,
  ];
  return patterns.some((p) => remoteUrl.includes(p));
}

/**
 * workspaceRoot 配下のリポジトリを再帰スキャンして解決する
 */
export function resolveWorkspacePath(workspaceRoot: string, repository: string): string | null {
  const root = workspaceRoot.startsWith("~")
    ? join(homedir(), workspaceRoot.slice(1))
    : resolve(workspaceRoot);

  return scanDir(root, repository, 0);
}

function scanDir(dir: string, repository: string, depth: number): string | null {
  if (depth > MAX_DEPTH) return null;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }

  // このディレクトリ自体が git リポジトリかチェック
  if (entries.includes(".git")) {
    const gitConfigPath = join(dir, ".git", "config");
    const remoteUrl = getRemoteOriginUrl(gitConfigPath);
    if (remoteUrl && matchesRepository(remoteUrl, repository)) {
      return dir;
    }
    // .git が見つかったが一致しなかった場合、サブフォルダは掘らない
    return null;
  }

  // サブディレクトリを再帰探索
  for (const entry of entries) {
    // ドット始まり・除外ディレクトリはスキップ
    if (entry.startsWith(".") || EXCLUDED_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    try {
      if (!statSync(fullPath).isDirectory()) continue;
    } catch {
      continue;
    }

    const found = scanDir(fullPath, repository, depth + 1);
    if (found) return found;
  }

  return null;
}
