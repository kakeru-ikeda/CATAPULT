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
  verifyInstallation,
} from "../services/github-repos.js";
import { JobGuard, JobLimitError } from "../services/job-guard.js";
import { getQueuePosition } from "../services/queue-status.js";

const prisma = new PrismaClient();
const jobQueue = new Queue("jobs", { connection: { url: process.env["REDIS_URL"]! } });
const jobGuard = new JobGuard();

// "owner/repo" パターンを検出する正規表現
const REPO_PATTERN = /([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/;

async function submitDiscordJob(
  user: User,
  task: string,
  repo: string,
  branch: string,
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
        name: `ジョブ進捗 - ${repo}`,
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
    // スレッド作成不可の場合はチャンネルにフォールバック
  }

  const relay = new DiscordJobStreamRelay(job.id, outputChannel);
  await relay.start();
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
        await submitDiscordJob(user, task, repo, branch, message);
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
      await showDiscordConfirmation(user, task, repo, selectedBranch, message, replyMsg);
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
  const top25 = repos.slice(0, 25);

  if (top25.length === 0) {
    await message.reply("利用可能なリポジトリが見つかりませんでした。");
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`repo_select:${message.id}`)
    .setPlaceholder("リポジトリを選択...")
    .addOptions(
      top25.map((repo) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(repo.full_name.split("/")[1] ?? repo.full_name)
          .setDescription(repo.full_name)
          .setValue(repo.full_name),
      ),
    );

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
  // ワンライナーパターン: owner/repo が含まれている場合
  const match = text.match(REPO_PATTERN);
  if (match?.[1]) {
    const repo = match[1];
    const isValid = await verifyInstallation(user.id, repo);
    if (isValid) {
      const branches = await listBranches(user.id, repo);
      const defaultBranch = branches[0]?.name ?? "main";
      await showDiscordConfirmation(user, text, repo, defaultBranch, message);
      return;
    }
  }

  // インタラクティブパターン: StringSelectMenu でリポジトリ選択
  await showDiscordRepoSelect(user, text, message);
}
