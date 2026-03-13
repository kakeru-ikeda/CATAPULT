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
import { getQueuePosition } from "../services/queue-status.js";

const prisma = new PrismaClient();
const jobQueue = new Queue("jobs", { connection: { url: process.env["REDIS_URL"]! } });
const jobGuard = new JobGuard();

// "owner/repo" パターンを検出する正規表現
const REPO_PATTERN = /([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/;

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

  // Discord スレッド内メンションの場合 channelId = thread.id → 前回ジョブを検索（軽量セッション）
  const parentJob = await prisma.job.findFirst({
    where: {
      userId: user.id,
      threadId: message.channelId,
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
      threadId: message.id,
      parentJobId: parentJob?.id ?? null,
      deliverableType:
        deliverableType === "pr"
          ? "PR"
          : deliverableType === "report"
            ? "REPORT"
            : deliverableType === "commit_only"
              ? "COMMIT_ONLY"
              : "REVIEW",
    },
  });

  const bullJob = await jobQueue.add("execute", { jobId: job.id });
  const { position, estimatedWaitMinutes } = await getQueuePosition(bullJob.id ?? job.id);

  const replyMsg = await message.reply(
    `📋 ジョブをキューに追加しました\n現在の待ち順位: ${position}番目\n推定待ち時間: 約${estimatedWaitMinutes}分`,
  );

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
      // スレッド ID をジョブに保存
      await prisma.job.update({
        where: { id: job.id },
        data: { threadId: thread.id },
      });
    }
  } catch {
    // スレッド作成不可（入れ子スレッド等）の場合はチャンネルにフォールバック
    // threadId を既存スレッドID（message.channelId）で更新してセッション継続を維持する
    await prisma.job.update({
      where: { id: job.id },
      data: { threadId: message.channelId },
    });
  }

  const relay = new DiscordJobStreamRelay(job.id, outputChannel, message.author.id);
  await relay.start();
}

export async function showDiscordDeliverableSelect(
  user: User,
  task: string,
  repo: string,
  branch: string,
  message: Message,
  replyMsg: Message,
): Promise<void> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`deliverable_select:${message.id}`)
    .setPlaceholder("完了形式を選択...")
    .addOptions([
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
    ]);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await replyMsg.edit({
    content:
      repo === ""
        ? `💬 **チャットエージェントモード** でどの形式で完了しますか？\n**タスク:** ${task}`
        : `**${repo}** \`${branch}\` でどの形式で完了しますか？\n**タスク:** ${task}`,
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
      const deliverableType = interaction.values[0] as DeliverableType;
      await replyMsg.edit({
        content:
          repo === ""
            ? `✅ ジョブを投入しました: 💬 チャットエージェントモード (${DELIVERABLE_LABELS[deliverableType]})`
            : `✅ ジョブを投入しました: \`${repo}\` - \`${branch}\` (${DELIVERABLE_LABELS[deliverableType]})`,
        components: [],
      });
      await submitDiscordJob(user, task, repo, branch, deliverableType, message);
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
        // リポジトリなし: ブランチ選択をスキップしてデリバラブル選択へ
        await showDiscordDeliverableSelect(user, task, "", "", message, replyMsg);
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

  // スレッド継続パターン: 同一チャンネル（スレッド）の直前 COMPLETED ジョブからリポジトリ・ブランチを引き継ぐ
  const sessionJob = await prisma.job.findFirst({
    where: { userId: user.id, threadId: message.channelId, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    select: { repository: true, branch: true },
  });
  if (sessionJob) {
    const replyMsg = await message.reply({
      content: `🔄 前回の **${sessionJob.repository}** \`${sessionJob.branch}\` を継続します。どの形式で完了しますか？`,
    });
    await showDiscordDeliverableSelect(
      user,
      text,
      sessionJob.repository,
      sessionJob.branch,
      message,
      replyMsg,
    );
    return;
  }

  // インタラクティブパターン: StringSelectMenu でリポジトリ選択
  await showDiscordRepoSelect(user, text, message);
}
