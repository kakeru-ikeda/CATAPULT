import { randomBytes } from "crypto";

import { PrismaClient } from "@prisma/client";
import type { AppMentionEvent } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import Redis from "ioredis";

import { handleTask } from "./task.js";

const prisma = new PrismaClient();
const redis = new Redis(process.env["REDIS_URL"]!);

async function handleUnauthenticatedUser(
  slackUserId: string,
  pendingTask: string,
  event: AppMentionEvent,
  client: WebClient,
): Promise<void> {
  if (pendingTask) {
    await redis.set(`pending:task:${slackUserId}`, pendingTask, "EX", 3600);
  }

  const state = randomBytes(32).toString("hex");
  await redis.set(
    `oauth:state:${state}`,
    JSON.stringify({
      platform: "slack",
      slackUserId,
      channelId: event.channel,
      threadTs: event.ts,
    }),
    "EX",
    600,
  );

  const appUrl = process.env["APP_URL"] ?? process.env["API_BASE_URL"] ?? "http://localhost:3000";
  const authUrl = `${appUrl}/api/auth/github?state=${state}&platform=slack`;

  await client.chat.postEphemeral({
    channel: event.channel,
    user: slackUserId,
    text: "GitHub アカウントと連携してください",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "CATAPULT を使うには GitHub アカウントとの連携が必要です。",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "GitHub で連携する 🔗" },
            url: authUrl,
            action_id: "github_auth",
          },
        ],
      },
    ],
  });
}

export async function handleMention(event: AppMentionEvent, client: WebClient): Promise<void> {
  const slackUserId = event.user;
  if (!slackUserId) return;

  const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();

  // スレッド返信の場合は thread_ts（親メッセージの ts）を使用し、セッション継続を実現する
  const threadTs =
    "thread_ts" in event && typeof event.thread_ts === "string" ? event.thread_ts : event.ts;

  const accountLink = await prisma.accountLink.findUnique({
    where: {
      platform_platformUserId: {
        platform: "SLACK",
        platformUserId: slackUserId,
      },
    },
    include: { user: true },
  });

  if (!accountLink) {
    await handleUnauthenticatedUser(slackUserId, text, event, client);
    return;
  }

  await handleTask(accountLink.user, text, event.channel, threadTs, client);
}
