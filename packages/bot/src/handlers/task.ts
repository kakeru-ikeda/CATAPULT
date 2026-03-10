import type { User } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import type { WebClient } from "@slack/web-api";
import { Queue } from "bullmq";

import { slackApp } from "../platforms/slack.js";
import { listBranches, verifyInstallation } from "../services/github-repos.js";
import { JobGuard, JobLimitError } from "../services/job-guard.js";
import { JobStreamRelay } from "../services/job-stream.js";
import { getQueuePosition } from "../services/queue-status.js";

const prisma = new PrismaClient();
const jobQueue = new Queue("jobs", { connection: { url: process.env["REDIS_URL"]! } });
const jobGuard = new JobGuard();

// "owner/repo" パターンを検出する正規表現
const REPO_PATTERN = /([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/;

export interface TaskContext {
  userId: string;
  repo: string;
  branch: string;
  task: string;
  channelId: string;
  threadTs: string;
  slackUserId: string;
}

export async function submitJob(ctx: TaskContext): Promise<void> {
  if (!slackApp) throw new Error("Slack is not enabled");
  const client = slackApp.client;

  try {
    await jobGuard.check(ctx.userId, ctx.repo);
  } catch (err) {
    if (err instanceof JobLimitError) {
      await client.chat.postMessage({
        channel: ctx.channelId,
        thread_ts: ctx.threadTs,
        text: `⚠️ ${err.message}`,
      });
      return;
    }
    throw err;
  }

  const job = await prisma.job.create({
    data: {
      userId: ctx.userId,
      repository: ctx.repo,
      branch: ctx.branch,
      prompt: ctx.task,
      status: "PENDING",
      platform: "SLACK",
      channelId: ctx.channelId,
      threadId: ctx.threadTs,
    },
  });

  const bullJob = await jobQueue.add("execute", { jobId: job.id });

  const { position, estimatedWaitMinutes } = await getQueuePosition(bullJob.id ?? job.id);

  await client.chat.postMessage({
    channel: ctx.channelId,
    thread_ts: ctx.threadTs,
    text: `📋 ジョブをキューに追加しました\n現在の待ち順位: ${position}番目\n推定待ち時間: 約${estimatedWaitMinutes}分`,
  });

  // JobStreamRelay を起動してリアルタイム進捗を投稿
  const relay = new JobStreamRelay(job.id, slackApp, ctx.channelId, ctx.threadTs);
  await relay.start();
}

export async function showConfirmation(
  user: User,
  repo: string,
  branch: string,
  task: string,
  channelId: string,
  threadTs: string,
  slackUserId: string,
  client: WebClient,
): Promise<void> {
  const ctxValue = JSON.stringify({
    userId: user.id,
    repo,
    branch,
    task,
    channelId,
    threadTs,
    slackUserId,
  });

  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: `実行確認: *${repo}* の \`${branch}\` ブランチで以下のタスクを実行しますか？\n> ${task}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*リポジトリ:* \`${repo}\`\n*ブランチ:* \`${branch}\`\n*タスク:* ${task}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "✅ 実行する" },
            style: "primary",
            action_id: "confirm_job",
            // value に起票者 ID を含めてボタン本人認証に使用
            value: `${Buffer.from(ctxValue).toString("base64")}:${slackUserId}`,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "❌ キャンセル" },
            style: "danger",
            action_id: "cancel_job",
            value: `cancel:${slackUserId}`,
          },
        ],
      },
    ],
  });
}

export async function handleTask(
  user: User,
  text: string,
  channelId: string,
  threadTs: string,
  client: WebClient,
): Promise<void> {
  const slackLink = await prisma.accountLink.findFirst({
    where: { userId: user.id, platform: "SLACK" },
  });
  const slackUserId = slackLink?.platformUserId ?? user.id;

  // ワンライナーパターン: owner/repo が含まれている場合
  const match = text.match(REPO_PATTERN);
  if (match?.[1]) {
    const repo = match[1];
    const isValid = await verifyInstallation(user.id, repo);
    if (isValid) {
      // デフォルトブランチを取得してブランチ選択なしで確認画面へ
      const branches = await listBranches(user.id, repo);
      const defaultBranch = branches[0]?.name ?? "main";
      await showConfirmation(
        user,
        repo,
        defaultBranch,
        text,
        channelId,
        threadTs,
        slackUserId,
        client,
      );
      return;
    }
  }

  // インタラクティブパターン: external_select でリポジトリ選択
  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: "どのリポジトリで作業しますか？",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*タスク:* ${text}\n\nリポジトリを選択してください:` },
      },
      {
        type: "actions",
        block_id: `repo_select:${Buffer.from(JSON.stringify({ task: text, channelId, threadTs, slackUserId })).toString("base64")}`,
        elements: [
          {
            type: "external_select",
            placeholder: { type: "plain_text", text: "リポジトリを選択..." },
            action_id: "select_repo",
            min_query_length: 0,
          },
        ],
      },
    ],
  });
}
