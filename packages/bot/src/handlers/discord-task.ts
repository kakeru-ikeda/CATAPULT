import type { User } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Message,
} from "discord.js";

import { DiscordJobStreamRelay } from "../services/discord-job-stream.js";
import {
  listBranches,
  listInstallationRepos,
  recordRecentBranch,
  recordRecentRepo,
  verifyInstallation,
} from "../services/github-repos.js";
import { JobGuard, JobLimitError } from "../services/job-guard.js";
import { fetchAvailableModels } from "../services/models.js";
import { getQueuePosition } from "../services/queue-status.js";

const prisma = new PrismaClient();
const jobQueue = new Queue("jobs", { connection: { url: process.env["REDIS_URL"]! } });
const jobGuard = new JobGuard();

// "owner/repo" パターンを検出する正規表現
const REPO_PATTERN = /([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/;

/**
 * セッション識別子として使う Discord チャンネルIDを返す。
 * ボットが作成する進捗スレッド内からのメンションを考慮し、
 * スレッドの場合は親チャンネルIDを使用する。
 */
function getSessionId(message: Message): string {
  if (message.channel.isThread()) {
    return message.channel.parentId ?? message.channelId;
  }
  return message.channelId;
}

type DeliverableType = "pr" | "report" | "commit_only" | "review";

const DELIVERABLE_LABELS: Record<DeliverableType, string> = {
  pr: "🔀 PR 作成",
  report: "🔍 調査・報告",
  commit_only: "📝 コミットのみ",
  review: "👁 コードレビュー",
};

async function submitDiscordJob(
  user: User,
  task: string,
  repo: string,
  branch: string,
  deliverableType: DeliverableType,
  message: Message,
  executionMode: "SERVER" | "LOCAL" = "SERVER",
  localAgentId?: string,
  model?: string,
): Promise<void> {
  try {
    await jobGuard.check(user.id, repo);
  } catch (err) {
    if (err instanceof JobLimitError) {
      await message.reply(`⚠️ ${err.message}`);
      return;
    }
    throw err;
  }

  // Discord スレッド内メンションの場合でも親チャンネルIDで統一（進捗スレッドからのメンションでも正しく継続できる）
  const sessionId = getSessionId(message);

  // 前回ジョブを検索（軽量セッション）
  const parentJob = await prisma.job.findFirst({
    where: {
      userId: user.id,
      threadId: sessionId,
      status: "COMPLETED",
    },
    orderBy: { completedAt: "desc" },
    select: { id: true },
  });

  const job = await prisma.job.create({
    data: {
      userId: user.id,
      repository: repo,
      branch,
      prompt: task,
      status: "PENDING",
      platform: "DISCORD",
      channelId: message.channelId,
      // セッション識別子は親チャンネルIDで統一（進捗スレッドIDではない）
      threadId: sessionId,
      parentJobId: parentJob?.id ?? null,
      deliverableType:
        deliverableType === "pr"
          ? "PR"
          : deliverableType === "report"
            ? "REPORT"
            : deliverableType === "commit_only"
              ? "COMMIT_ONLY"
              : "REVIEW",
      executionMode: executionMode === "LOCAL" && localAgentId ? "LOCAL" : "SERVER",
      ...(executionMode === "LOCAL" && localAgentId ? { localAgentId } : {}),
      ...(model ? { model } : {}),
    },
  });

  let queueText: string;
  if (executionMode === "LOCAL" && localAgentId) {
    // ローカル実行: BullMQ には積まない
    queueText = `💻 ローカルエージェントにジョブを割り当てました\nエージェントが起動していれば自動的に開始します`;
  } else {
    const bullJob = await jobQueue.add("execute", { jobId: job.id });
    const { position } = await getQueuePosition(bullJob.id ?? job.id);
    queueText =
      position <= 1
        ? `📋 ジョブをキューに追加しました\nすぐに開始します`
        : `📋 ジョブをキューに追加しました\n現在の待ち順位: ${position}番目`;
  }

  const replyMsg = await message.reply(queueText);

  // ストリーミング出力用チャンネルを設定（スレッドを優先）
  // PartialGroupDMChannel 以外はすべて send() をサポートするためキャスト
  type SendableChannel =
    Parameters<DiscordJobStreamRelay["start"]> extends never
      ? never
      : ConstructorParameters<typeof DiscordJobStreamRelay>[1];
  let outputChannel = message.channel as unknown as SendableChannel;
  try {
    if (replyMsg.inGuild()) {
      const thread = await replyMsg.startThread({
        name: repo ? `ジョブ進捗 - ${repo}` : "ジョブ進捗 - チャットエージェント",
        autoArchiveDuration: 60,
      });
      outputChannel = thread as unknown as SendableChannel;
      // 進捗スレッドは出力用のみ。threadId（セッション識別子）は message.channelId のまま維持する
    }
  } catch {
    // スレッド作成不可（入れ子スレッドなど）の場合はチャンネルにフォールバック（threadId は変更不要）
  }

  const relay = new DiscordJobStreamRelay(job.id, outputChannel, message.author.id);
  await relay.start();
}

interface SessionContext {
  prUrl: string;
  workerBranch: string;
}

export async function showDiscordDeliverableSelect(
  user: User,
  task: string,
  repo: string,
  branch: string,
  message: Message,
  replyMsg: Message,
  sessionCtx?: SessionContext,
): Promise<void> {
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  await prisma.localAgent.updateMany({
    where: {
      userId: user.id,
      status: "ONLINE",
      lastHeartbeatAt: { not: null, lt: oneMinuteAgo },
    },
    data: { status: "OFFLINE" },
  });

  // ONLINE なローカルエージェントを取得
  const onlineAgents = await prisma.localAgent.findMany({
    where: { userId: user.id, status: "ONLINE" },
    select: { id: true, name: true },
  });

  const availableModels = await fetchAvailableModels();
  const hasPr = !!sessionCtx?.prUrl;

  const deliverableSelect = new StringSelectMenuBuilder()
    .setCustomId(`deliverable_select:${message.id}`)
    .setPlaceholder("完了形式を選択...")
    .addOptions(
      hasPr
        ? [
            {
              label: "✅ このPRに追加コミット",
              value: "commit_only",
              description: "このPRに追加コミットを積む（推奨）",
            },
            {
              label: "🔍 調査・報告",
              value: "report",
              description: "コードを変更せず調査・報告",
            },
            {
              label: "🔀 別PR を作成",
              value: "pr",
              description: "別のPRを新たに作成する",
            },
            {
              label: "👁 コードレビュー",
              value: "review",
              description: "変更なし、レビュー結果を投稿",
            },
          ]
        : [
            {
              label: "🔀 PR 作成",
              value: "pr",
              description: "変更してプルリクエストを作成",
            },
            {
              label: "🔍 調査・報告",
              value: "report",
              description: "コードを変更せず調査・報告",
            },
            {
              label: "📝 コミットのみ",
              value: "commit_only",
              description: "ブランチにコミット。PR なし",
            },
            {
              label: "👁 コードレビュー",
              value: "review",
              description: "変更なし、レビュー結果を投稿",
            },
          ],
    );

  const deliverableRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    deliverableSelect,
  );

  const components: ActionRowBuilder<StringSelectMenuBuilder>[] = [deliverableRow];

  if (onlineAgents.length > 0) {
    const executionModeSelect = new StringSelectMenuBuilder()
      .setCustomId(`execution_mode_select:${message.id}`)
      .setPlaceholder("実行環境を選択...")
      .addOptions([
        {
          label: "🖥️ サーバー実行",
          value: "server",
          description: "CATAPULT サーバーで実行（デフォルト）",
        },
        ...onlineAgents.slice(0, 24).map((a) => ({
          label: `💻 ローカル実行（${a.name}）`,
          value: `local:${a.id}`,
          description: "ローカルの開発環境で実行",
        })),
      ]);
    const executionModeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      executionModeSelect,
    );
    components.push(executionModeRow);
  }

  if (availableModels.length > 0) {
    const modelSelect = new StringSelectMenuBuilder()
      .setCustomId(`model_select:${message.id}`)
      .setPlaceholder("モデルを選択...")
      .addOptions([
        {
          label: "🤖 Auto",
          value: "auto",
          description: "デフォルト（Copilot が自動選択）",
        },
        ...availableModels.slice(0, 24).map((m) => ({
          label: m.displayName ?? m.name,
          value: m.name,
        })),
      ]);
    components.splice(components.length - 1, 0, new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modelSelect));
  }

  await replyMsg.edit({
    content:
      repo === ""
        ? `💬 **チャットエージェントモード** でどの形式で完了しますか？\n**タスク:** ${task}`
        : hasPr
          ? `**${repo}** \`${branch}\` の継続（[PR を確認](${sessionCtx.prUrl})\uff09\n**タスク:** ${task}`
          : `**${repo}** \`${branch}\` でどの形式で完了しますか？\n**タスク:** ${task}`,
    components,
  });

  // 選択状態
  let selectedDeliverable: DeliverableType | null = null;
  let selectedExecutionMode: string = "server";
  let selectedModel: string | undefined = undefined;

  const collector = replyMsg.createMessageComponentCollector({
    filter: (i) => i.user.id === message.author.id,
    time: 2 * 60 * 1000,
  });

  collector.on("collect", (interaction) => {
    void (async () => {
      if (!interaction.isStringSelectMenu()) return;
      await interaction.deferUpdate();

      if (interaction.customId.startsWith("deliverable_select:")) {
        selectedDeliverable = interaction.values[0] as DeliverableType;
      } else if (interaction.customId.startsWith("execution_mode_select:")) {
        selectedExecutionMode = interaction.values[0] ?? "server";
      } else if (interaction.customId.startsWith("model_select:")) {
        const val = interaction.values[0];
        selectedModel = val === "auto" ? undefined : val;
      }

      // 両方選択済みになったら（またはエージェントなし＝deliverableのみ）ジョブ投入
      if (selectedDeliverable !== null) {
        collector.stop("selected");
      }
    })();
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      void replyMsg.edit({
        content: "タイムアウトしました。再度メンションしてください。",
        components: [],
      });
      return;
    }

    if (reason === "selected" && selectedDeliverable !== null) {
      const isLocal = selectedExecutionMode.startsWith("local:");
      const localAgentId = isLocal ? selectedExecutionMode.slice("local:".length) : undefined;

      void replyMsg.edit({
        content:
          repo === ""
            ? `✅ ジョブを投入しました: 💬 チャットエージェントモード (${DELIVERABLE_LABELS[selectedDeliverable]})`
            : `✅ ジョブを投入しました: \`${repo}\` - \`${branch}\` (${DELIVERABLE_LABELS[selectedDeliverable]})`,
        components: [],
      });
      void submitDiscordJob(
        user,
        task,
        repo,
        branch,
        selectedDeliverable,
        message,
        isLocal ? "LOCAL" : "SERVER",
        localAgentId,
        selectedModel,
      );
    }
  });
}

export async function showDiscordConfirmation(
  user: User,
  task: string,
  repo: string,
  branch: string,
  message: Message,
  replyMsg?: Message,
): Promise<void> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm_discord:${message.id}`)
      .setLabel("✅ 実行する")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cancel_discord:${message.id}`)
      .setLabel("❌ キャンセル")
      .setStyle(ButtonStyle.Danger),
  );

  const content = `**リポジトリ:** \`${repo}\`\n**ブランチ:** \`${branch}\`\n**タスク:** ${task}`;

  let confirmMsg: Message;
  if (replyMsg) {
    confirmMsg = await replyMsg.edit({ content, components: [row] });
  } else {
    confirmMsg = await message.reply({ content, components: [row] });
  }

  const collector = confirmMsg.createMessageComponentCollector({
    filter: (i) => i.user.id === message.author.id,
    time: 2 * 60 * 1000,
    max: 1,
  });

  collector.on("collect", (interaction) => {
    void (async () => {
      await interaction.deferUpdate();
      if (interaction.customId.startsWith("confirm_discord")) {
        await confirmMsg.edit({
          content: `✅ ジョブを投入しました: \`${repo}\` - \`${branch}\``,
          components: [],
        });
        await submitDiscordJob(user, task, repo, branch, "pr", message);
      } else {
        await confirmMsg.edit({ content: "❌ キャンセルしました。", components: [] });
      }
    })();
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      void confirmMsg.edit({
        content: "タイムアウトしました。再度メンションしてください。",
        components: [],
      });
    }
  });
}

async function showDiscordBranchSelect(
  user: User,
  task: string,
  repo: string,
  message: Message,
  replyMsg: Message,
): Promise<void> {
  const branches = await listBranches(user.id, repo);

  if (branches.length === 0) {
    await replyMsg.edit({ content: "ブランチが見つかりませんでした。", components: [] });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`branch_select:${message.id}`)
    .setPlaceholder("ブランチを選択...")
    .addOptions(
      branches
        .slice(0, 25)
        .map((b) => new StringSelectMenuOptionBuilder().setLabel(b.name).setValue(b.name)),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await replyMsg.edit({
    content: `**${repo}** のブランチを選択してください`,
    components: [row],
  });

  const collector = replyMsg.createMessageComponentCollector({
    filter: (i) => i.user.id === message.author.id,
    time: 2 * 60 * 1000,
    max: 1,
  });

  collector.on("collect", (interaction) => {
    void (async () => {
      if (!interaction.isStringSelectMenu()) return;
      await interaction.deferUpdate();
      const selectedBranch = interaction.values[0]!;
      await recordRecentBranch(user.id, repo, selectedBranch);
      await showDiscordDeliverableSelect(user, task, repo, selectedBranch, message, replyMsg);
    })();
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      void replyMsg.edit({
        content: "タイムアウトしました。再度メンションしてください。",
        components: [],
      });
    }
  });
}

async function showDiscordRepoSelect(user: User, task: string, message: Message): Promise<void> {
  const repos = await listInstallationRepos(user.id, "");
  const top24 = repos.slice(0, 24);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`repo_select:${message.id}`)
    .setPlaceholder("リポジトリを選択...")
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel("なし（コードベース不要）")
        .setDescription("リポジトリを指定せずチャットエージェントとして実行")
        .setValue("__none__"),
      ...top24.map((repo) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(repo.full_name.split("/")[1] ?? repo.full_name)
          .setDescription(repo.full_name)
          .setValue(repo.full_name),
      ),
    ]);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const replyMsg = await message.reply({
    content: `**タスク:** ${task}\n\nどのリポジトリで作業しますか？`,
    components: [row],
  });

  const collector = replyMsg.createMessageComponentCollector({
    filter: (i) => i.user.id === message.author.id,
    time: 2 * 60 * 1000,
    max: 1,
  });

  collector.on("collect", (interaction) => {
    void (async () => {
      if (!interaction.isStringSelectMenu()) return;
      await interaction.deferUpdate();
      const selectedRepo = interaction.values[0]!;
      if (selectedRepo === "__none__") {
        // リポジトリなし: チャットエージェントモード → deliverable 選択不要で即時投入
        await replyMsg.edit({
          content: `💬 **チャットエージェントモード** で実行します\n**タスク:** ${task}`,
          components: [],
        });
        await submitDiscordJob(user, task, "", "", "report", message);
        return;
      }
      await recordRecentRepo(user.id, selectedRepo);
      await showDiscordBranchSelect(user, task, selectedRepo, message, replyMsg);
    })();
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      void replyMsg.edit({
        content: "タイムアウトしました。再度メンションしてください。",
        components: [],
      });
    }
  });
}

export async function handleDiscordTask(user: User, text: string, message: Message): Promise<void> {
  // ワンライナーパターン: owner/repo が含まれている場合（スレッド継続より優先）
  const match = text.match(REPO_PATTERN);
  if (match?.[1]) {
    const repo = match[1];
    const isValid = await verifyInstallation(user.id, repo);
    if (isValid) {
      const branches = await listBranches(user.id, repo);
      const defaultBranch = branches[0]?.name ?? "main";
      const replyMsg = await message.reply({
        content: `🔍 **${repo}** の \`${defaultBranch}\` でどの形式で完了しますか？`,
      });
      await showDiscordDeliverableSelect(user, text, repo, defaultBranch, message, replyMsg);
      return;
    }
  }

  // スレッド継続パターン: スレッド内からのメンション時のみ、直前 COMPLETED ジョブからリポジトリ・ブランチを引き継ぐ
  // 親チャンネルからのメンションは常に新規扱いにする
  if (!message.channel.isThread()) {
    await showDiscordRepoSelect(user, text, message);
    return;
  }

  const sessionId = getSessionId(message);
  const sessionJob = await prisma.job.findFirst({
    where: { userId: user.id, threadId: sessionId, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    select: { repository: true, branch: true, workerBranch: true, prUrl: true },
  });
  if (sessionJob) {
    const continueBranch = sessionJob.workerBranch ?? sessionJob.branch;
    const sessionCtx =
      sessionJob.prUrl && sessionJob.workerBranch
        ? { prUrl: sessionJob.prUrl, workerBranch: sessionJob.workerBranch }
        : undefined;
    const replyMsg = await message.reply({
      content: sessionCtx
        ? `🔄 前回の **${sessionJob.repository}** \`${continueBranch}\` (前回: ${sessionCtx.prUrl}) を継続します。どの形式で完了しますか？`
        : `🔄 前回の **${sessionJob.repository}** \`${continueBranch}\` を継続します。どの形式で完了しますか？`,
    });
    await showDiscordDeliverableSelect(
      user,
      text,
      sessionJob.repository,
      continueBranch,
      message,
      replyMsg,
      sessionCtx,
    );
    return;
  }

  // インタラクティブパターン: StringSelectMenu でリポジトリ選択
  await showDiscordRepoSelect(user, text, message);
}
