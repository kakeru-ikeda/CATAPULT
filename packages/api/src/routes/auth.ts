import { randomBytes } from "crypto";

import { PrismaClient } from "@prisma/client";
import { WebClient } from "@slack/web-api";
import type { Router, Request, Response } from "express";
import { Router as createRouter } from "express";
import Redis from "ioredis";

import { authMiddleware, issueJwt } from "../middleware/auth.js";
import { encrypt } from "../services/token-vault.js";

const prisma = new PrismaClient();
const redis = new Redis(process.env["REDIS_URL"]!);
const slackClient = new WebClient(process.env["SLACK_BOT_TOKEN"]);

interface GitHubTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
  email: string | null;
}

interface OAuthStateData {
  platform: "slack" | "discord" | "web";
  slackUserId?: string;
  discordUserId?: string;
  channelId?: string;
  threadTs?: string;
  redirectUrl?: string;
}

async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
}> {
  const clientId = process.env["GITHUB_APP_CLIENT_ID"];
  const clientSecret = process.env["GITHUB_APP_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error("GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET must be set");
  }

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });

  const data = (await response.json()) as GitHubTokenResponse;

  if (data.error || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "Failed to exchange code for token");
  }

  const now = Date.now();
  const expiresAt = data.expires_in ? new Date(now + data.expires_in * 1000) : null;
  const refreshTokenExpiresAt = data.refresh_token_expires_in
    ? new Date(now + data.refresh_token_expires_in * 1000)
    : null;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
    refreshTokenExpiresAt,
  };
}

async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: { Authorization: `token ${accessToken}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub user: ${response.status}`);
  }
  return response.json() as Promise<GitHubUser>;
}

const router: Router = createRouter();

// GitHub OAuth 開始エンドポイント（Slack/Discord フロー）: state で検証後 GitHub 認可ページへリダイレクト
router.get("/github", async (_req: Request, res: Response) => {
  const { state, platform, redirect } = _req.query;

  const clientId = process.env["GITHUB_APP_CLIENT_ID"];
  if (!clientId) {
    res.status(500).send("GitHub App is not configured");
    return;
  }

  // Web 管理画面からの OAuth: redirect クエリパラメータで判別
  if (redirect && typeof redirect === "string") {
    const webState = randomBytes(16).toString("hex");
    const stateData: OAuthStateData = {
      platform: "web",
      redirectUrl: redirect,
    };
    await redis.set(`oauth:state:${webState}`, JSON.stringify(stateData), "EX", 600);

    const scopes = "read:user,user:email";
    const redirectUri = `${process.env["APP_URL"] ?? ""}/api/auth/github/callback`;
    const githubAuthUrl =
      `https://github.com/login/oauth/authorize` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(webState)}` +
      `&scope=${encodeURIComponent(scopes)}`;
    res.redirect(githubAuthUrl);
    return;
  }

  if (!state || typeof state !== "string") {
    res.status(400).send("Missing state parameter");
    return;
  }

  const scopes = "read:user,user:email";
  const redirectUri = `${process.env["APP_URL"] ?? ""}/api/auth/github/callback`;
  const githubAuthUrl =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}` +
    `&scope=${encodeURIComponent(scopes)}`;

  void platform; // platform は state に格納済み
  res.redirect(githubAuthUrl);
});

// GitHub OAuth コールバック
router.get("/github/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code || typeof code !== "string" || !state || typeof state !== "string") {
    res.status(400).send("Missing code or state parameter");
    return;
  }

  // state 検証（CSRF 防止）
  const stateDataRaw = await redis.get(`oauth:state:${state}`);
  if (!stateDataRaw) {
    res.status(400).send("Invalid or expired state");
    return;
  }
  await redis.del(`oauth:state:${state}`);

  const stateData = JSON.parse(stateDataRaw) as OAuthStateData;

  try {
    // トークン交換
    const { accessToken, refreshToken, expiresAt, refreshTokenExpiresAt } =
      await exchangeCodeForTokens(code);

    // GitHub ユーザー情報取得
    const githubUser = await fetchGitHubUser(accessToken);

    // ユーザーをアップサート
    const user = await prisma.user.upsert({
      where: { githubUsername: githubUser.login },
      update: {
        githubAvatarUrl: githubUser.avatar_url,
        githubToken: encrypt(accessToken),
        refreshToken: refreshToken ? encrypt(refreshToken) : undefined,
        tokenExpiresAt: expiresAt ?? undefined,
        refreshTokenExpiresAt: refreshTokenExpiresAt ?? undefined,
      },
      create: {
        githubUsername: githubUser.login,
        githubAvatarUrl: githubUser.avatar_url,
        githubToken: encrypt(accessToken),
        refreshToken: refreshToken ? encrypt(refreshToken) : null,
        tokenExpiresAt: expiresAt,
        refreshTokenExpiresAt: refreshTokenExpiresAt,
        role: "USER",
      },
    });

    // AccountLink をアップサート
    if (stateData.platform === "slack" && stateData.slackUserId) {
      await prisma.accountLink.upsert({
        where: {
          platform_platformUserId: {
            platform: "SLACK",
            platformUserId: stateData.slackUserId,
          },
        },
        update: { userId: user.id },
        create: {
          userId: user.id,
          platform: "SLACK",
          platformUserId: stateData.slackUserId,
        },
      });

      // pendingTask の確認
      const pendingTask = await redis.get(`pending:task:${stateData.slackUserId}`);

      // Slack DM で完了通知
      await slackClient.chat.postMessage({
        channel: stateData.slackUserId,
        text: `✅ GitHub アカウント (*${githubUser.login}*) と連携しました！`,
        blocks: pendingTask
          ? [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `✅ GitHub アカウント (*${githubUser.login}*) と連携しました！\n\n先ほどのタスクを続行しますか？\n> ${pendingTask}`,
                },
              },
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "▶️ 続行する" },
                    style: "primary",
                    action_id: "resume_pending_task",
                    value: `resume:${stateData.slackUserId}`,
                  },
                  {
                    type: "button",
                    text: { type: "plain_text", text: "✖️ スキップ" },
                    action_id: "skip_pending_task",
                    value: `skip:${stateData.slackUserId}`,
                  },
                ],
              },
            ]
          : undefined,
      });
    }

    if (stateData.platform === "discord" && stateData.discordUserId) {
      await prisma.accountLink.upsert({
        where: {
          platform_platformUserId: {
            platform: "DISCORD",
            platformUserId: stateData.discordUserId,
          },
        },
        update: { userId: user.id },
        create: {
          userId: user.id,
          platform: "DISCORD",
          platformUserId: stateData.discordUserId,
        },
      });
    }

    // Web 管理画面フロー: JWT を発行してフロントエンドへリダイレクト
    if (stateData.platform === "web" && stateData.redirectUrl) {
      const token = issueJwt({
        id: user.id,
        role: user.role as "ADMIN" | "USER",
        githubUsername: user.githubUsername,
      });
      const redirectUrl = new URL("/auth/callback", stateData.redirectUrl);
      redirectUrl.searchParams.set("token", token);
      redirectUrl.searchParams.set("role", user.role);
      res.redirect(redirectUrl.toString());
      return;
    }

    res.send(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>連携完了 - CATAPULT</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0B0F19;color:#e2e8f0}div{text-align:center}h1{font-size:2rem;margin-bottom:0.5rem}p{color:#8B949E}</style></head><body><div><h1>✅ GitHub 連携完了</h1><p>GitHub アカウント <strong>${githubUser.login}</strong> と連携しました。</p><p>このウィンドウを閉じてください。</p></div></body></html>`,
    );
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).send("Authentication failed");
  }
});

// pendingTask スキップ処理（Slack ボタンのフォールバック）
router.post("/skip-pending", async (req: Request, res: Response) => {
  const { slackUserId } = req.body as { slackUserId?: string };
  if (slackUserId) {
    await redis.del(`pending:task:${slackUserId}`);
  }
  res.json({ ok: true });
});

// 現在のユーザー情報取得 GET /api/auth/me
router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      githubUsername: true,
      githubAvatarUrl: true,
      role: true,
    },
  });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

// アカウント連携一覧 GET /api/auth/me/links
router.get("/me/links", authMiddleware, async (req: Request, res: Response) => {
  const links = await prisma.accountLink.findMany({
    where: { userId: req.user!.id },
    select: { platform: true, platformUserId: true },
  });
  res.json(links);
});

export { router as authRouter };
