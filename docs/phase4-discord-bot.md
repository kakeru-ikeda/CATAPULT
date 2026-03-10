# Phase 4: Discord Bot 実装

## 目的

Discord のインターフェースとして、ユーザーが `@copilot` にメンションするだけで GitHub Copilot CLI のジョブを起動できる Bot を実装します。Discord.js を使用し、Slack Bot と同等の機能を提供します。

## 期間目安

**3〜4日**

## タスク一覧

### 1. Discord.js セットアップ

```bash
npm install discord.js
```

```typescript
// packages/bot/src/platforms/discord.ts

import { Client, GatewayIntentBits } from "discord.js";

export const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

discordClient.once("ready", () => {
  console.info(`Discord Bot logged in as ${discordClient.user?.tag}`);
});

await discordClient.login(process.env.DISCORD_BOT_TOKEN!);
```

### 2. メンション検知 (messageCreate イベント)

```typescript
// packages/bot/src/handlers/discord-mention.ts

discordClient.on("messageCreate", async (message) => {
  // Bot 自身のメッセージは無視
  if (message.author.bot) return;

  // メンションされているか確認
  if (!message.mentions.has(discordClient.user!)) return;

  const discordUserId = message.author.id;
  const text = message.content
    .replace(/<@!?\d+>/g, "")
    .trim();

  // アカウント連携確認
  const accountLink = await prisma.accountLink.findUnique({
    where: {
      platform_platformUserId: { platform: "DISCORD", platformUserId: discordUserId },
    },
    include: { user: true },
  });

  if (!accountLink) {
    await handleUnauthenticatedDiscordUser(discordUserId, text, message);
    return;
  }

  await handleDiscordTask(accountLink.user, text, message);
});
```

### 3. 未連携ユーザーの認証誘導

Discord では DM またはチャンネルにボタンを表示します。

```typescript
// packages/bot/src/handlers/discord-mention.ts

async function handleUnauthenticatedDiscordUser(
  discordUserId: string,
  pendingTask: string,
  message: Message,
): Promise<void> {
  // pendingTask を保存
  if (pendingTask) {
    await redis.set(`pending:task:discord:${discordUserId}`, pendingTask, "EX", 3600);
  }

  const state = crypto.randomBytes(32).toString("hex");
  await redis.set(
    `oauth:state:${state}`,
    JSON.stringify({
      discordUserId,
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
    }),
    "EX",
    600,
  );

  const authUrl = `https://${process.env.API_BASE_URL}/api/auth/github?state=${state}&platform=discord`;

  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("GitHub で連携する 🔗")
      .setStyle(ButtonStyle.Link)
      .setURL(authUrl),
  );

  // DM を試みる（ブロックされている場合はチャンネルに投稿）
  try {
    const dmChannel = await message.author.createDM();
    await dmChannel.send({
      content: "CATAPULT を使うには GitHub アカウントとの連携が必要です。",
      components: [row],
    });
  } catch {
    // DM がブロックされている場合のフォールバック
    await message.reply({
      content: "GitHub アカウントとの連携が必要です（DM が届かない場合はこちらから）。",
      components: [row],
    });
  }
}
```

### 4. StringSelectMenu によるリポジトリ選択（最大25件）

Discord の Select Menu は最大25件まで表示できます。

```typescript
// packages/bot/src/handlers/discord-task.ts

import {
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
} from "discord.js";

async function showRepoSelect(
  user: User,
  prompt: string,
  message: Message,
): Promise<void> {
  const repos = await githubRepos.listInstallationRepos(user.id, "");
  const top25 = repos.slice(0, 25); // Discord の制限

  const select = new StringSelectMenuBuilder()
    .setCustomId(`repo_select:${message.id}`)
    .setPlaceholder("リポジトリを選択...")
    .addOptions(
      top25.map((repo) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(repo.name)
          .setDescription(repo.full_name)
          .setValue(repo.full_name),
      ),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const reply = await message.reply({
    content: "どのリポジトリで作業しますか？",
    components: [row],
  });

  // インタラクションの待ち受け（タイムアウト: 2分）
  const collector = reply.createMessageComponentCollector({
    filter: (i) => i.user.id === message.author.id,
    time: 2 * 60 * 1000,
  });

  collector.on("collect", async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;
    await interaction.deferUpdate();
    const selectedRepo = interaction.values[0]!;
    await showBranchSelect(user, prompt, selectedRepo, message, reply);
    collector.stop();
  });

  collector.on("end", (_, reason) => {
    if (reason === "time") {
      reply.edit({ content: "タイムアウトしました。再度メンションしてください。", components: [] });
    }
  });
}
```

### 5. ブランチ選択 → 確認 → 実行

```typescript
async function showBranchSelect(
  user: User,
  prompt: string,
  repo: string,
  message: Message,
  reply: Message,
): Promise<void> {
  const branches = await githubRepos.listBranches(user.id, repo);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`branch_select:${message.id}`)
    .setPlaceholder("ブランチを選択...")
    .addOptions(
      branches.slice(0, 25).map((b) =>
        new StringSelectMenuOptionBuilder().setLabel(b.name).setValue(b.name),
      ),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await reply.edit({
    content: `**${repo}** のブランチを選択してください`,
    components: [row],
  });

  const collector = reply.createMessageComponentCollector({
    filter: (i) => i.user.id === message.author.id,
    time: 2 * 60 * 1000,
  });

  collector.on("collect", async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;
    await interaction.deferUpdate();
    const selectedBranch = interaction.values[0]!;
    await showConfirmation(user, prompt, repo, selectedBranch, message, reply);
    collector.stop();
  });
}
```

### 6. MessageComponentCollector の操作待ち受け（タイムアウト2分）

上記の実装に含まれています。各セレクトメニューに `time: 2 * 60 * 1000`（2分）のタイムアウトを設定します。

### 7. DM ブロック時のフォールバック

上記の「未連携ユーザーの認証誘導」に含まれています。`try/catch` で DM 送信を試み、失敗した場合はチャンネルにフォールバックします。

### 8. ストリーミング投稿（2000文字チャンク分割）

Discord の2000文字制限に対応するため、メッセージを自動分割して投稿します。

```typescript
// packages/bot/src/formatters/discord-embeds.ts

export function splitIntoChunks(text: string, maxLength = 1900): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

// Discord スレッドへの投稿
async function postToThread(
  channel: TextChannel,
  threadId: string,
  text: string,
): Promise<void> {
  const thread = await channel.threads.fetch(threadId);
  if (!thread) return;

  const chunks = splitIntoChunks(text);
  for (const chunk of chunks) {
    await thread.send(chunk);
    await sleep(1000); // レートリミット対策
  }
}
```

## 成果物

- `packages/bot/src/platforms/discord.ts` - Discord.js セットアップ
- `packages/bot/src/handlers/discord-mention.ts` - メンション検知・認証誘導
- `packages/bot/src/handlers/discord-task.ts` - タスク処理・UI 構築
- `packages/bot/src/formatters/discord-embeds.ts` - チャンク分割・フォーマット

## 完了条件

- [ ] `@copilot` メンションで Discord Bot が反応する
- [ ] 未連携ユーザーに認証ボタンが表示される（DM またはチャンネル）
- [ ] DM がブロックされている場合にチャンネルへフォールバックする
- [ ] StringSelectMenu でリポジトリを選択できる（最大25件）
- [ ] ブランチ選択後に確認画面が表示される
- [ ] 確認後にジョブが実行される
- [ ] 2分のタイムアウトが正しく動作する
- [ ] ストリーミング投稿が2000文字でチャンク分割される
