import { PrismaClient } from "@prisma/client";
import type { App, BlockAction, StaticSelectAction } from "@slack/bolt";
import Redis from "ioredis";

import { listBranches, recordRecentBranch, recordRecentRepo } from "../services/github-repos.js";
import { fetchAvailableModels } from "../services/models.js";

import { normalizePreferredBranchName, validatePreferredBranchName } from "./branch-preference.js";
import { showConfirmation, submitJob, type TaskContext, type DeliverableType } from "./task.js";

const prisma = new PrismaClient();
const redis = new Redis(process.env["REDIS_URL"]!);

const BRANCH_BLOCK_ID = "branch_block";
const BRANCH_SELECT_ACTION_ID = "branch_select";
const EXECUTION_MODE_BLOCK_ID = "execution_mode_block";
const EXECUTION_MODE_ACTION_ID = "execution_mode_select";
const MODEL_BLOCK_ID = "model_block";
const MODEL_ACTION_ID = "model_select";
const DELIVERABLE_BLOCK_ID = "deliverable_block";
const DELIVERABLE_ACTION_ID = "deliverable_select";
const PREFERRED_BRANCH_BLOCK_ID = "preferred_branch_block";
const PREFERRED_BRANCH_ACTION_ID = "preferred_branch_input";
const PREFERRED_BRANCH_MODAL_CALLBACK_ID = "submit_pr_with_branch";

interface RepoSelectContext {
  task: string;
  channelId: string;
  threadTs: string;
  slackUserId: string;
}

interface BranchModalMetadata extends RepoSelectContext {
  userId: string;
  repo: string;
}

interface BranchModalState {
  branch?: string;
  deliverableType: DeliverableType;
  executionMode: string;
  model: string;
  preferredBranchName?: string;
}

interface LocalAgentOption {
  id: string;
  name: string;
}

interface ModelOption {
  name: string;
  displayName: string | null;
}

function buildBranchSelectionView(
  metadata: BranchModalMetadata,
  branches: Array<{ name: string }>,
  onlineAgents: LocalAgentOption[],
  availableModels: ModelOption[],
  state: BranchModalState,
) {
  const executionOptions = [
    {
      text: { type: "plain_text" as const, text: "🖥️ サーバー実行" },
      value: "server",
    },
    ...onlineAgents.map((agent) => ({
      text: { type: "plain_text" as const, text: `💻 ローカル実行（${agent.name}）` },
      value: `local:${agent.id}`,
    })),
  ];

  const modelOptions = [
    {
      text: { type: "plain_text" as const, text: "🤖 Auto" },
      value: "auto",
    },
    ...availableModels.map((model) => ({
      text: { type: "plain_text" as const, text: model.displayName ?? model.name },
      value: model.name,
    })),
  ];

  const deliverableOptions = [
    { text: { type: "plain_text" as const, text: "🔀 PR 作成" }, value: "pr" },
    { text: { type: "plain_text" as const, text: "🔍 調査・報告" }, value: "report" },
    { text: { type: "plain_text" as const, text: "📝 コミットのみ" }, value: "commit_only" },
    { text: { type: "plain_text" as const, text: "👁 コードレビュー" }, value: "review" },
  ] as const;

  return {
    type: "modal" as const,
    callback_id: "select_branch",
    private_metadata: JSON.stringify(metadata),
    title: { type: "plain_text" as const, text: "ブランチを選択" },
    submit: { type: "plain_text" as const, text: "実行" },
    close: { type: "plain_text" as const, text: "キャンセル" },
    blocks: [
      {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: `*リポジトリ:* \`${metadata.repo}\`` },
      },
      {
        type: "input" as const,
        block_id: BRANCH_BLOCK_ID,
        element: {
          type: "static_select" as const,
          action_id: BRANCH_SELECT_ACTION_ID,
          ...(state.branch
            ? {
                initial_option: {
                  text: { type: "plain_text" as const, text: state.branch },
                  value: state.branch,
                },
              }
            : {}),
          options: branches.slice(0, 100).map((branch) => ({
            text: { type: "plain_text" as const, text: branch.name },
            value: branch.name,
          })),
        },
        label: { type: "plain_text" as const, text: "ベースブランチ" },
      },
      ...(onlineAgents.length > 0
        ? [
            {
              type: "input" as const,
              block_id: EXECUTION_MODE_BLOCK_ID,
              element: {
                type: "static_select" as const,
                action_id: EXECUTION_MODE_ACTION_ID,
                initial_option:
                  executionOptions.find((option) => option.value === state.executionMode) ??
                  executionOptions[0],
                options: executionOptions,
              },
              label: { type: "plain_text" as const, text: "実行環境" },
              hint: {
                type: "plain_text" as const,
                text: "ローカル実行: リポジトリが見つからない場合は自動でサーバー実行に切り替わります",
              },
            },
          ]
        : []),
      {
        type: "input" as const,
        block_id: MODEL_BLOCK_ID,
        optional: true,
        element: {
          type: "static_select" as const,
          action_id: MODEL_ACTION_ID,
          initial_option:
            modelOptions.find((option) => option.value === state.model) ?? modelOptions[0],
          options: modelOptions,
        },
        label: { type: "plain_text" as const, text: "モデル" },
      },
      {
        type: "input" as const,
        block_id: DELIVERABLE_BLOCK_ID,
        dispatch_action: true,
        element: {
          type: "static_select" as const,
          action_id: DELIVERABLE_ACTION_ID,
          initial_option:
            deliverableOptions.find((option) => option.value === state.deliverableType) ??
            deliverableOptions[0],
          options: [...deliverableOptions],
        },
        label: { type: "plain_text" as const, text: "完了形式" },
      },
      ...(state.deliverableType === "pr"
        ? [
            {
              type: "input" as const,
              block_id: PREFERRED_BRANCH_BLOCK_ID,
              optional: true,
              element: {
                type: "plain_text_input" as const,
                action_id: PREFERRED_BRANCH_ACTION_ID,
                ...(state.preferredBranchName ? { initial_value: state.preferredBranchName } : {}),
                placeholder: {
                  type: "plain_text" as const,
                  text: "copilot/job-xxxxxx/fix-login-bug",
                },
              },
              label: { type: "plain_text" as const, text: "作業ブランチ名（任意）" },
              hint: {
                type: "plain_text" as const,
                text: "PR 作成時だけ使います。未入力なら Copilot に任せます。",
              },
            },
          ]
        : []),
    ],
  };
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

    const oneMinuteAgo = new Date(Date.now() - 60_000);
    await prisma.localAgent.updateMany({
      where: {
        userId: accountLink.user.id,
        status: "ONLINE",
        lastHeartbeatAt: { not: null, lt: oneMinuteAgo },
      },
      data: { status: "OFFLINE" },
    });

    // ONLINE のローカルエージェントを取得
    const onlineAgents = await prisma.localAgent.findMany({
      where: { userId: accountLink.user.id, status: "ONLINE" },
      select: { id: true, name: true },
    });

    // リポジトリ「なし」選択: チャットエージェントモード
    if (repo === "__none__") {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: "modal",
          callback_id: "select_branch",
          private_metadata: JSON.stringify({
            userId: accountLink.user.id,
            repo: "",
            task,
            channelId,
            threadTs,
            slackUserId,
          }),
          title: { type: "plain_text", text: "タスク設定" },
          submit: { type: "plain_text", text: "実行" },
          close: { type: "plain_text", text: "キャンセル" },
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "💬 *チャットエージェントモード*\nリポジトリを指定せず、コードベースに囚われないエージェントとして実行します。",
              },
            },
          ],
        },
      });
      return;
    }

    await recordRecentRepo(accountLink.user.id, repo);
    const branches = await listBranches(accountLink.user.id, repo);
    const availableModels = await fetchAvailableModels();

    // ブランチ選択モーダルを開く
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildBranchSelectionView(
        {
          userId: accountLink.user.id,
          repo,
          task,
          channelId,
          threadTs,
          slackUserId,
        },
        branches,
        onlineAgents,
        availableModels,
        {
          branch: branches[0]?.name,
          deliverableType: "pr",
          executionMode: "server",
          model: "auto",
        },
      ),
    });
  });

  app.action<BlockAction>(DELIVERABLE_ACTION_ID, async ({ ack, body, client }) => {
    await ack();

    if (!body.view) {
      return;
    }

    const metadata = JSON.parse(body.view.private_metadata) as BranchModalMetadata;
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    await prisma.localAgent.updateMany({
      where: {
        userId: metadata.userId,
        status: "ONLINE",
        lastHeartbeatAt: { not: null, lt: oneMinuteAgo },
      },
      data: { status: "OFFLINE" },
    });

    const [branches, availableModels, onlineAgents] = await Promise.all([
      listBranches(metadata.userId, metadata.repo),
      fetchAvailableModels(),
      prisma.localAgent.findMany({
        where: { userId: metadata.userId, status: "ONLINE" },
        select: { id: true, name: true },
      }),
    ]);

    await client.views.update({
      view_id: body.view.id,
      hash: body.view.hash,
      view: buildBranchSelectionView(metadata, branches, onlineAgents, availableModels, {
        branch:
          body.view.state.values[BRANCH_BLOCK_ID]?.[BRANCH_SELECT_ACTION_ID]?.selected_option
            ?.value ?? branches[0]?.name,
        deliverableType:
          (body.view.state.values[DELIVERABLE_BLOCK_ID]?.[DELIVERABLE_ACTION_ID]?.selected_option
            ?.value as DeliverableType | undefined) ?? "pr",
        executionMode:
          body.view.state.values[EXECUTION_MODE_BLOCK_ID]?.[EXECUTION_MODE_ACTION_ID]
            ?.selected_option?.value ?? "server",
        model:
          body.view.state.values[MODEL_BLOCK_ID]?.[MODEL_ACTION_ID]?.selected_option?.value ??
          "auto",
        preferredBranchName:
          body.view.state.values[PREFERRED_BRANCH_BLOCK_ID]?.[PREFERRED_BRANCH_ACTION_ID]?.value ??
          undefined,
      }),
    });
  });

  // ブランチ選択モーダル送信
  app.view("select_branch", async ({ view, ack }) => {
    const metadata = JSON.parse(view.private_metadata) as BranchModalMetadata;
    const branchValue =
      view.state.values[BRANCH_BLOCK_ID]?.[BRANCH_SELECT_ACTION_ID]?.selected_option?.value;

    // チャットエージェントモード（リポジトリなし）の場合はブランチ選択をスキップ
    const isChatMode = metadata.repo === "";
    if (!branchValue && !isChatMode) {
      await ack({
        response_action: "errors",
        errors: {
          [BRANCH_BLOCK_ID]: "ベースブランチを選択してください。",
        },
      });
      return;
    }

    if (!isChatMode) {
      const preferredBranchName =
        view.state.values[PREFERRED_BRANCH_BLOCK_ID]?.[PREFERRED_BRANCH_ACTION_ID]?.value;
      const preferredBranchError = validatePreferredBranchName(preferredBranchName);
      if (preferredBranchError) {
        await ack({
          response_action: "errors",
          errors: {
            [PREFERRED_BRANCH_BLOCK_ID]: preferredBranchError,
          },
        });
        return;
      }

      await ack();
      await recordRecentBranch(metadata.userId, metadata.repo, branchValue!);
    } else {
      await ack();
    }

    // チャットエージェントモードはdeliverable選択なし → report 固定
    const deliverableValue: DeliverableType = isChatMode
      ? "report"
      : ((view.state.values[DELIVERABLE_BLOCK_ID]?.[DELIVERABLE_ACTION_ID]?.selected_option
          ?.value ?? "pr") as DeliverableType);

    // 実行モード選択（optional: ONLINEエージェントがいない場合はブロック自体なし）
    const executionModeValue =
      view.state.values[EXECUTION_MODE_BLOCK_ID]?.[EXECUTION_MODE_ACTION_ID]?.selected_option
        ?.value ?? "server";
    const isLocal = executionModeValue.startsWith("local:");
    const localAgentId = isLocal ? executionModeValue.slice("local:".length) : undefined;

    // モデル選択（optional: 未選択または "auto" の場合は undefined）
    const modelValue =
      view.state.values[MODEL_BLOCK_ID]?.[MODEL_ACTION_ID]?.selected_option?.value ?? "auto";
    const model = modelValue === "auto" ? undefined : modelValue;
    const preferredBranchName = normalizePreferredBranchName(
      view.state.values[PREFERRED_BRANCH_BLOCK_ID]?.[PREFERRED_BRANCH_ACTION_ID]?.value,
    );

    const user = await prisma.user.findUniqueOrThrow({ where: { id: metadata.userId } });

    // モーダルでブランチ＋完了形式を選択済み = 確認完了 → 直接ジョブ投入
    await submitJob({
      userId: user.id,
      repo: metadata.repo,
      branch: branchValue ?? "",
      task: metadata.task,
      deliverableType: deliverableValue,
      channelId: metadata.channelId,
      threadTs: metadata.threadTs,
      slackUserId: metadata.slackUserId,
      executionMode: isLocal ? "LOCAL" : "SERVER",
      localAgentId,
      model,
      preferredBranchName: deliverableValue === "pr" ? preferredBranchName : undefined,
    });
  });

  // ジョブ実行（完了形式ボタン）
  // action_id は "submit_job_pr" / "submit_job_report" 等、deliverableType 付きのためパターンマッチで登録
  const DELIVERABLE_TYPES: DeliverableType[] = ["pr", "report", "commit_only", "review"];
  for (const dt of DELIVERABLE_TYPES) {
    app.action<BlockAction>(`submit_job_${dt}`, async ({ action, body, ack, respond, client }) => {
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

      if (deliverableType === "pr" && ctx.repo !== "") {
        await client.views.open({
          trigger_id: body.trigger_id,
          view: {
            type: "modal",
            callback_id: PREFERRED_BRANCH_MODAL_CALLBACK_ID,
            private_metadata: JSON.stringify({
              ctx,
              channelId: body.channel?.id ?? ctx.channelId,
              messageTs: body.message?.ts,
            }),
            title: { type: "plain_text", text: "PR 作成設定" },
            submit: { type: "plain_text", text: "実行" },
            close: { type: "plain_text", text: "キャンセル" },
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*リポジトリ:* \`${ctx.repo}\`\n*ベースブランチ:* \`${ctx.branch}\`\n*タスク:* ${ctx.task}`,
                },
              },
              {
                type: "input",
                block_id: PREFERRED_BRANCH_BLOCK_ID,
                optional: true,
                element: {
                  type: "plain_text_input",
                  action_id: PREFERRED_BRANCH_ACTION_ID,
                  placeholder: {
                    type: "plain_text",
                    text: "copilot/job-xxxxxx/fix-login-bug",
                  },
                },
                label: { type: "plain_text", text: "作業ブランチ名（任意）" },
                hint: {
                  type: "plain_text",
                  text: "未入力なら Copilot に任せます。",
                },
              },
            ],
          },
        });
        return;
      }

      await submitJob({ ...ctx, deliverableType });

      await respond({
        text: `✅ ジョブを投入しました: \`${ctx.repo}\` - \`${ctx.branch}\``,
        replace_original: true,
      });
    });
  }

  app.view(PREFERRED_BRANCH_MODAL_CALLBACK_ID, async ({ view, ack, client }) => {
    const metadata = JSON.parse(view.private_metadata) as {
      ctx: Omit<TaskContext, "deliverableType">;
      channelId: string;
      messageTs?: string;
    };

    const preferredBranchName =
      view.state.values[PREFERRED_BRANCH_BLOCK_ID]?.[PREFERRED_BRANCH_ACTION_ID]?.value;
    const preferredBranchError = validatePreferredBranchName(preferredBranchName);

    if (preferredBranchError) {
      await ack({
        response_action: "errors",
        errors: {
          [PREFERRED_BRANCH_BLOCK_ID]: preferredBranchError,
        },
      });
      return;
    }

    await ack();

    await submitJob({
      ...metadata.ctx,
      deliverableType: "pr",
      preferredBranchName: normalizePreferredBranchName(preferredBranchName),
    });

    if (metadata.messageTs) {
      await client.chat.update({
        channel: metadata.channelId,
        ts: metadata.messageTs,
        text: `✅ ジョブを投入しました: \`${metadata.ctx.repo}\` - \`${metadata.ctx.branch}\``,
        blocks: [],
      });
    }
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

  // 🛑 停止ボタン：実行中ジョブをキャンセル
  app.action<BlockAction>("stop_job", async ({ action, body, ack, respond }) => {
    await ack();

    const operatorId = body.user.id;
    const value = "value" in action ? action.value : undefined;
    if (!value) return;

    // value = "${jobId}:${slackUserId}"
    const lastColon = value.lastIndexOf(":");
    const ownerId = value.slice(lastColon + 1);
    const jobId = value.slice(0, lastColon);

    if (ownerId !== operatorId) {
      await respond({
        text: "このアクションを実行する権限がありません。",
        response_type: "ephemeral",
        replace_original: false,
      });
      return;
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      await respond({
        text: "ジョブが見つかりません。",
        response_type: "ephemeral",
        replace_original: false,
      });
      return;
    }

    // ジョブのオーナー検証
    const accountLink = await prisma.accountLink.findUnique({
      where: { platform_platformUserId: { platform: "SLACK", platformUserId: operatorId } },
    });
    if (!accountLink || accountLink.userId !== job.userId) {
      await respond({
        text: "このジョブをキャンセルする権限がありません。",
        response_type: "ephemeral",
        replace_original: false,
      });
      return;
    }

    if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
      await respond({
        text: "このジョブはすでに終了しています。",
        response_type: "ephemeral",
        replace_original: false,
      });
      return;
    }

    if (job.status === "PENDING") {
      // キューから取り出される前にキャンセル
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "CANCELLED", completedAt: new Date() },
      });
      await redis.publish(`job:${jobId}`, JSON.stringify({ type: "cancelled" }));
    } else if (job.status === "RUNNING") {
      // Worker プロセスにキャンセル信号を送信（Relay が cancelled イベントを受信してメッセージ更新）
      await redis.publish(`job:${jobId}:cancel`, "cancel");
    }

    await respond({
      text: "🛑 停止リクエストを送信しました。",
      response_type: "ephemeral",
      replace_original: false,
    });
  });
}
