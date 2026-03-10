import { createDecipheriv } from "crypto";

import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

const prisma = new PrismaClient();
const redis = new Redis(process.env["REDIS_URL"]!);

const CACHE_TTL = 300; // 5分キャッシュ

function getKey(): Buffer {
  const keyHex = process.env["TOKEN_ENCRYPTION_KEY"];
  if (!keyHex) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters");
  return key;
}

function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");
  const [ivB64, authTagB64, encryptedB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export interface GithubRepo {
  full_name: string;
  default_branch: string;
  private: boolean;
}

export interface GithubBranch {
  name: string;
}

async function getAccessToken(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return decrypt(user.githubToken);
}

async function fetchGitHub<T>(userId: string, path: string): Promise<T> {
  const token = await getAccessToken(userId);
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
