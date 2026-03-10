import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";

import { encrypt, decrypt } from "./token-vault.js";

const prisma = new PrismaClient();
const redis = new Redis(process.env["REDIS_URL"]!);

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const LOCK_TTL_SECONDS = 30;
const POLL_INTERVAL_MS = 500;
const POLL_MAX_MS = 10_000;

async function waitForRefresh(userId: string): Promise<string> {
  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const fiveMinutesFromNow = new Date(Date.now() + FIVE_MINUTES_MS);
    if (user.tokenExpiresAt && user.tokenExpiresAt > fiveMinutesFromNow) {
      return decrypt(user.githubToken);
    }
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return decrypt(user.githubToken);
}

async function exchangeRefreshToken(
  refreshToken: string,
): Promise<{ token: string; refreshToken: string; expiresAt: Date; refreshTokenExpiresAt: Date }> {
  const clientId = process.env["GITHUB_APP_CLIENT_ID"];
  const clientSecret = process.env["GITHUB_APP_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error("GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET must be set");
  }

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) throw new Error(`GitHub token refresh failed: ${response.statusText}`);

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    refresh_token_expires_in: number;
    error?: string;
  };

  if (data.error) throw new Error(`GitHub token refresh error: ${data.error}`);

  const now = Date.now();
  return {
    token: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(now + data.expires_in * 1000),
    refreshTokenExpiresAt: new Date(now + data.refresh_token_expires_in * 1000),
  };
}

export async function refreshTokenIfNeeded(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const fiveMinutesFromNow = new Date(Date.now() + FIVE_MINUTES_MS);
  if (user.tokenExpiresAt && user.tokenExpiresAt > fiveMinutesFromNow) {
    return decrypt(user.githubToken);
  }

  if (!user.refreshToken) {
    throw new Error(`User ${userId} has no refresh token. Re-authentication required.`);
  }

  const lockKey = `token:refresh:lock:${userId}`;
  const lockAcquired = await redis.set(lockKey, "1", "EX", LOCK_TTL_SECONDS, "NX");

  if (!lockAcquired) {
    return waitForRefresh(userId);
  }

  try {
    const freshUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (freshUser.tokenExpiresAt && freshUser.tokenExpiresAt > fiveMinutesFromNow) {
      return decrypt(freshUser.githubToken);
    }

    if (!freshUser.refreshToken) {
      throw new Error(`User ${userId} has no refresh token. Re-authentication required.`);
    }

    const newTokens = await exchangeRefreshToken(decrypt(freshUser.refreshToken));

    await prisma.user.update({
      where: { id: userId },
      data: {
        githubToken: encrypt(newTokens.token),
        refreshToken: encrypt(newTokens.refreshToken),
        tokenExpiresAt: newTokens.expiresAt,
        refreshTokenExpiresAt: newTokens.refreshTokenExpiresAt,
      },
    });

    return newTokens.token;
  } finally {
    await redis.del(lockKey);
  }
}

export async function batchRefreshExpiringTokens(): Promise<void> {
  const expiringUsers = await prisma.user.findMany({
    where: {
      tokenExpiresAt: { lte: new Date(Date.now() + TWO_HOURS_MS) },
      refreshToken: { not: null },
    },
    select: { id: true },
  });

  for (const user of expiringUsers) {
    await refreshTokenIfNeeded(user.id).catch((err: unknown) => {
      console.error(`Failed to refresh token for user ${user.id}:`, err);
    });
  }
}
