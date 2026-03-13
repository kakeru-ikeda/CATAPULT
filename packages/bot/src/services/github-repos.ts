import Redis from "ioredis";

import { refreshTokenIfNeeded } from "./token-refresher.js";

const redis = new Redis(process.env["REDIS_URL"]!);

const CACHE_TTL = 300; // 5分キャッシュ
const RECENT_TTL = 30 * 24 * 60 * 60; // 30日間保持
const RECENT_REPOS_MAX = 20;
const RECENT_BRANCHES_MAX = 10;

export interface GithubRepo {
  full_name: string;
  default_branch: string;
  private: boolean;
}

export interface GithubBranch {
  name: string;
}

async function fetchGitHub<T>(userId: string, path: string): Promise<T> {
  const token = await refreshTokenIfNeeded(userId);
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function listInstallationRepos(userId: string, query: string): Promise<GithubRepo[]> {
  const cacheKey = `repos:${userId}`;
  const cached = await redis.get(cacheKey);

  let repos: GithubRepo[];
  if (cached) {
    repos = JSON.parse(cached) as GithubRepo[];
  } else {
    interface ReposResponse {
      items?: GithubRepo[];
    }
    // ユーザーのインストール済みリポジトリを取得（最大100件）
    const response = await fetchGitHub<GithubRepo[] | ReposResponse>(
      userId,
      "/user/repos?sort=updated&per_page=100&type=all",
    );
    repos = Array.isArray(response) ? response : (response.items ?? []);
    await redis.set(cacheKey, JSON.stringify(repos), "EX", CACHE_TTL);
  }

  const filtered = query
    ? repos.filter((r) => r.full_name.toLowerCase().includes(query.toLowerCase()))
    : repos;

  // 最近使った順で先頭に並べる
  const recentNames = await redis.zrevrange(`recent_repos:${userId}`, 0, -1);
  if (recentNames.length === 0) return filtered;

  const recentSet = new Set(recentNames);
  const nameToRepo = new Map(filtered.map((r) => [r.full_name, r]));
  const recentFirst = recentNames.flatMap((name) => {
    const repo = nameToRepo.get(name);
    return repo ? [repo] : [];
  });
  const rest = filtered.filter((r) => !recentSet.has(r.full_name));
  return [...recentFirst, ...rest];
}

export async function listBranches(userId: string, repo: string): Promise<GithubBranch[]> {
  const cacheKey = `branches:${userId}:${repo}`;
  const cached = await redis.get(cacheKey);
  let branches: GithubBranch[];
  if (cached) {
    branches = JSON.parse(cached) as GithubBranch[];
  } else {
    branches = await fetchGitHub<GithubBranch[]>(userId, `/repos/${repo}/branches?per_page=100`);
    await redis.set(cacheKey, JSON.stringify(branches), "EX", CACHE_TTL);
  }

  // 最近使った順で先頭に並べる
  const recentNames = await redis.zrevrange(`recent_branches:${userId}:${repo}`, 0, -1);
  if (recentNames.length === 0) return branches;

  const recentSet = new Set(recentNames);
  const nameToB = new Map(branches.map((b) => [b.name, b]));
  const recentFirst = recentNames.flatMap((name) => {
    const b = nameToB.get(name);
    return b ? [b] : [];
  });
  const rest = branches.filter((b) => !recentSet.has(b.name));
  return [...recentFirst, ...rest];
}

export async function recordRecentRepo(userId: string, repoFullName: string): Promise<void> {
  const key = `recent_repos:${userId}`;
  await redis.zadd(key, Date.now(), repoFullName);
  await redis.expire(key, RECENT_TTL);
  // 古いエントリを削除して上限を維持
  await redis.zremrangebyrank(key, 0, -(RECENT_REPOS_MAX + 1));
}

export async function recordRecentBranch(
  userId: string,
  repo: string,
  branch: string,
): Promise<void> {
  const key = `recent_branches:${userId}:${repo}`;
  await redis.zadd(key, Date.now(), branch);
  await redis.expire(key, RECENT_TTL);
  await redis.zremrangebyrank(key, 0, -(RECENT_BRANCHES_MAX + 1));
}

export async function verifyInstallation(userId: string, repo: string): Promise<boolean> {
  try {
    await fetchGitHub(userId, `/repos/${repo}`);
    return true;
  } catch {
    return false;
  }
}
