import { PrismaClient } from "@prisma/client";
import type { App, BlockAction, StaticSelectAction } from "@slack/bolt";
import Redis from "ioredis";

import { listBranches } from "../services/github-repos.js";

import { showConfirmation, submitJob, type TaskContext, type DeliverableType } from "./task.js";

const prisma = new PrismaClient();
const redis = new Redis(process.env["REDIS_URL"]!);

interface RepoSelectContext {
  task: string;
  channelId: string;
  threadTs: string;
  slackUserId: string;
}

export function registerInteractiveHandlers(app: App): void {
  // リポジトリ選択 (external_select)
  app.action<BlockAction>("select_repo", async ({ action, body, client, ack }) => {
    await ack();

    const selectedOption = (action as StaticSelectAction).selected_option;
    if (!selectedOption) return;

    const repo = selectedOption.value;
    const slackUserId = body.user.id;

    // block_id からコンテキストを復元
    const blockId = body.actions[0]?.block_id ?? "";
    const contextBase64 = blockId.startsWith("repo_select:")
      ? blockId.slice("repo_select:".length)
      : "";
    let ctx: RepoSelectContext | null = null;
    try {
      ctx = JSON.parse(Buffer.from(contextBase64, "base64").toString("utf8")) as RepoSelectContext;
    } catch {
      ctx = null;
    }

    const task = ctx?.task ?? "";
    const channelId = ctx?.channelId ?? body.channel?.id ?? "";
    const threadTs = ctx?.threadTs ?? body.message?.ts ?? "";

    const accountLink = await prisma.accountLink.findUnique({
      where: { platform_platformUserId: { platform: "SLACK", platformUserId: slackUserId } },
      include: { user: true },
    });
    if (!accountLink) return;

    const branches = await listBranches(accountLink.user.id, repo);

    // ブランチ選択モーダルを開く
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: "select_branch",
        private_metadata: JSON.stringify({
          userId: accountLink.user.id,
          repo,
          task,
          channelId,
          threadTs,
          slackUserId,
        }),
        title: { type: "plain_text", text: "ブランチを選択" },
        submit: { type: "plain_text", text: "次へ" },
        close: { type: "plain_text", text: "キャンセル" },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*リポジトリ:* \`${repo}\`` },
          },
          {
            type: "input",
            block_id: "branch_block",
            element: {
              type: "static_select",
              action_id: "branch_select",
              options: branches.slice(0, 100).map((b) => ({
                text: { type: "plain_text" as const, text: b.name },
                value: b.name,
              })),
            },
            label: { type: "plain_text", text: "ブランチ" },
          },
          {
            type: "input",
            block_id: "deliverable_block",
            element: {
              type: "static_select",
              action_id: "deliverable_select",
              initial_option: {
                text: { type: "plain_text" as const, text: "🔀 PR 作成" },
                value: "pr",
              },
              options: [
                { text: { type: "plain_text" as const, text: "🔀 PR 作成" }, value: "pr" },
                { text: { type: "plain_text" as const, text: "🔍 調査・報告" }, value: "report" },
                {
                  text: { type: "plain_text" as const, text: "📝 コミットのみ" },
                  value: "commit_only",
                },
                {
                  text: { type: "plain_text" as const, text: "👁 コードレビュー" },
                  value: "review",
                },
              ],
            },
            label: { type: "plain_text", text: "完了形式" },
          },
        ],
      },
    });
  });

  // ブランチ選択モーダル送信
  app.view("select_branch", async ({ view, ack }) => {
    await ack();

    interface BranchModalMetadata {
      userId: string;
      repo: string;
      task: string;
      channelId: string;
      threadTs: string;
      slackUserId: string;
    }

    const metadata = JSON.parse(view.private_metadata) as BranchModalMetadata;
    const branchValue =
      view.state.values["branch_block"]?.["branch_select"]?.selected_option?.value;
    if (!branchValue) return;

    const deliverableValue = (view.state.values["deliverable_block"]?.["deliverable_select"]
      ?.selected_option?.value ?? "pr") as DeliverableType;

    const user = await prisma.user.findUniqueOrThrow({ where: { id: metadata.userId } });

    // モーダルでブランチ＋完了形式を選択済み = 確認完了 → 直接ジョブ投入
    await submitJob({
      userId: user.id,
      repo: metadata.repo,
      branch: branchValue,
      task: metadata.task,
      deliverableType: deliverableValue,
      channelId: metadata.channelId,
      threadTs: metadata.threadTs,
      slackUserId: metadata.slackUserId,
    });
  });

  // ジョブ実行（完了形式ボタン）
  app.action<BlockAction>("submit_job", async ({ action, body, ack, respond }) => {
    await ack();

    const operatorId = body.user.id;
    const value = "value" in action ? action.value : undefined;
    if (!value) return;

    // value = base64(ctx):deliverableType:slackUserId
    const parts = value.split(":");
    const ownerId = parts[parts.length - 1]!;
    const deliverableType = parts[parts.length - 2] as DeliverableType;
    const ctxBase64 = parts.slice(0, parts.length - 2).join(":");

    if (ownerId !== operatorId) {
      await respond({
        text: "このアクションを実行する権限がありません。",
        response_type: "ephemeral",
        replace_original: false,
      });
      return;
    }

    let ctx: Omit<TaskContext, "deliverableType">;
    try {
      ctx = JSON.parse(Buffer.from(ctxBase64, "base64").toString("utf8")) as Omit<
        TaskContext,
        "deliverableType"
      >;
    } catch {
      await respond({
        text: "無効なコンテキストです。",
        response_type: "ephemeral",
        replace_original: false,
      });
      return;
    }

    await submitJob({ ...ctx, deliverableType });

    await respond({
      text: `✅ ジョブを投入しました: \`${ctx.repo}\` - \`${ctx.branch}\``,
      replace_original: true,
    });
  });

  // ジョブ実行確認ボタン（下位互換）（下位互換）
  app.action<BlockAction>("confirm_job", async ({ action, body, ack, respond }) => {
    await ack();

    const operatorId = body.user.id;
    const value = "value" in action ? action.value : undefined;
    if (!value) return;

    // value 末尾の slackUserId と操作者を照合
    const lastColon = value.lastIndexOf(":");
    const ownerId = value.slice(lastColon + 1);
    const ctxBase64 = value.slice(0, lastColon);

    if (ownerId !== operatorId) {
      await respond({
        text: "このアクションを実行する権限がありません。",
        response_type: "ephemeral",
        replace_original: false,
      });
      return;
    }

    let ctx: TaskContext;
    try {
      ctx = JSON.parse(Buffer.from(ctxBase64, "base64").toString("utf8")) as TaskContext;
    } catch {
      await respond({
        text: "無効なコンテキストです。",
        response_type: "ephemeral",
        replace_original: false,
      });
      return;
    }

    await submitJob(ctx);

    // 確認メッセージを更新
    await respond({
      text: `✅ ジョブを投入しました: \`${ctx.repo}\` - \`${ctx.branch}\``,
      replace_original: true,
    });
  });

  // キャンセルボタン
  app.action<BlockAction>("cancel_job", async ({ ack, respond }) => {
    await ack();
    await respond({ text: "❌ キャンセルしました。", replace_original: true });
  });

  // pendingTask 続行ボタン（OAuth 連携後のリトライ）
  app.action<BlockAction>("resume_pending_task", async ({ action, body, client, ack }) => {
    await ack();

    const slackUserId = body.user.id;
    const value = "value" in action ? action.value : undefined;
    if (!value) return;

    // value から起票者 ID を検証
    const ownerId = value.split(":").pop();
    if (ownerId !== slackUserId) return;

    const pendingTask = await redis.get(`pending:task:${slackUserId}`);
    if (!pendingTask) {
      await client.chat.postMessage({
        channel: slackUserId,
        text: "保留中のタスクが見つかりませんでした。",
      });
      return;
    }

    await redis.del(`pending:task:${slackUserId}`);

    const accountLink = await prisma.accountLink.findUnique({
      where: { platform_platformUserId: { platform: "SLACK", platformUserId: slackUserId } },
      include: { user: true },
    });
    if (!accountLink) return;

    // DM チャンネルで再開
    const channelId = slackUserId;
    const threadTs = body.message?.ts ?? "";
    await showConfirmation(
      accountLink.user,
      "", // repo は未知 → showConfirmation 内でインタラクティブフローへ
      "",
      pendingTask,
      channelId,
      threadTs,
      slackUserId,
      client,
    ).catch(async () => {
      // repo/branch 未設定の場合は interactive フローへ
      const { handleTask } = await import("./task.js");
      await handleTask(accountLink.user, pendingTask, channelId, threadTs, client);
    });
  });
}
