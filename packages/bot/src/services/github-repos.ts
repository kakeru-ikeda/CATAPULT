import Redis from "ioredis";

import { refreshTokenIfNeeded } from "./token-refresher.js";

const redis = new Redis(process.env["REDIS_URL"]!);

const CACHE_TTL = 300; // 5分キャッシュ

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

  if (!query) return repos;
  const lowerQuery = query.toLowerCase();
  return repos.filter((r) => r.full_name.toLowerCase().includes(lowerQuery));
}

export async function listBranches(userId: string, repo: string): Promise<GithubBranch[]> {
  const cacheKey = `branches:${userId}:${repo}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as GithubBranch[];
  }

  const branches = await fetchGitHub<GithubBranch[]>(
    userId,
    `/repos/${repo}/branches?per_page=100`,
  );
  await redis.set(cacheKey, JSON.stringify(branches), "EX", CACHE_TTL);
  return branches;
}

export async function verifyInstallation(userId: string, repo: string): Promise<boolean> {
  try {
    await fetchGitHub(userId, `/repos/${repo}`);
    return true;
  } catch {
    return false;
  }
}
