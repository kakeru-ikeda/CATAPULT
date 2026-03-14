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

export type DeliverableType = "pr" | "report" | "commit_only" | "review";

export const DELIVERABLE_LABELS: Record<DeliverableType, string> = {
  pr: "🔀 PR 作成",
  report: "🔍 調査・報告",
  commit_only: "📝 コミットのみ",
  review: "👁 コードレビュー",
};

export interface TaskContext {
  userId: string;
  repo: string;
  branch: string;
  task: string;
  deliverableType: DeliverableType;
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

  // 同一スレッドの直前 COMPLETED ジョブを検索（軽量セッション）
  const parentJob = ctx.threadTs
    ? await prisma.job.findFirst({
        where: {
          userId: ctx.userId,
          threadId: ctx.threadTs,
          status: "COMPLETED",
        },
        orderBy: { completedAt: "desc" },
        select: { id: true },
      })
    : null;

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
      parentJobId: parentJob?.id ?? null,
      deliverableType:
        ctx.deliverableType === "pr"
          ? "PR"
          : ctx.deliverableType === "report"
            ? "REPORT"
            : ctx.deliverableType === "commit_only"
              ? "COMMIT_ONLY"
              : "REVIEW",
    },
  });

  const bullJob = await jobQueue.add("execute", { jobId: job.id });

  const { position } = await getQueuePosition(bullJob.id ?? job.id);
  const queueText =
    position <= 1
      ? `📋 ジョブをキューに追加しました\nすぐに開始します`
      : `📋 ジョブをキューに追加しました\n現在の待ち順位: ${position}番目`;

  await client.chat.postMessage({
    channel: ctx.channelId,
    thread_ts: ctx.threadTs,
    text: queueText,
  });

  // JobStreamRelay を起動してリアルタイム進捗を投稿
  const relay = new JobStreamRelay(job.id, slackApp, ctx.channelId, ctx.threadTs, ctx.slackUserId);
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
  const ctxBase64 = Buffer.from(
    JSON.stringify({
      userId: user.id,
      repo,
      branch,
      task,
      channelId,
      threadTs,
      slackUserId,
    }),
  ).toString("base64");

  const deliverableButtons = (
    [
      { value: "pr" as DeliverableType, label: "🔀 PR 作成" },
      { value: "report" as DeliverableType, label: "🔍 調査・報告" },
      { value: "commit_only" as DeliverableType, label: "📝 コミットのみ" },
      { value: "review" as DeliverableType, label: "👁 コードレビュー" },
    ] as const
  ).map(({ value, label }) => ({
    type: "button" as const,
    text: { type: "plain_text" as const, text: label },
    action_id: "submit_job",
    // value = base64(ctx):deliverableType:slackUserId
    value: `${ctxBase64}:${value}:${slackUserId}`,
  }));

  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: `実行確認: *${repo}* の \`${branch}\` ブランチで以下のタスクを実行しますか？\n> ${task}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*リポジトリ:* \`${repo}\`\n*ブランチ:* \`${branch}\`\n*タスク:* ${task}\n\nどの形式で完了しますか？`,
        },
      },
      {
        type: "actions",
        elements: [
          ...deliverableButtons,
          {
            type: "button" as const,
            text: { type: "plain_text" as const, text: "❌ キャンセル" },
            style: "danger" as const,
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

  // スレッド継続パターン: 同一スレッドの直前 COMPLETED ジョブからリポジトリ・ブランチを引き継ぐ
  // ワンライナー（テキストに owner/repo 含む）の場合はそちらを優先する
  const match = text.match(REPO_PATTERN);
  if (!match?.[1]) {
    const sessionJob = await prisma.job.findFirst({
      where: { userId: user.id, threadId: threadTs, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      select: { repository: true, branch: true },
    });
    if (sessionJob) {
      await showConfirmation(
        user,
        sessionJob.repository,
        sessionJob.branch,
        text,
        channelId,
        threadTs,
        slackUserId,
        client,
      );
      return;
    }
  }

  // ワンライナーパターン: owner/repo が含まれている場合
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
