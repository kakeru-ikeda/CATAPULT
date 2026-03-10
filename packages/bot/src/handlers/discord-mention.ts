import { randomBytes } from "crypto";

import { PrismaClient } from "@prisma/client";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Message } from "discord.js";
import Redis from "ioredis";

import { discordClient } from "../platforms/discord.js";

import { handleDiscordTask } from "./discord-task.js";

const prisma = new PrismaClient();
const redis = new Redis(process.env["REDIS_URL"]!);

async function handleUnauthenticatedDiscordUser(
  discordUserId: string,
  pendingTask: string,
  message: Message,
): Promise<void> {
  if (pendingTask) {
    await redis.set(`pending:task:discord:${discordUserId}`, pendingTask, "EX", 3600);
  }

  const state = randomBytes(32).toString("hex");
  await redis.set(
    `oauth:state:${state}`,
    JSON.stringify({
      platform: "discord",
      discordUserId,
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
    }),
    "EX",
    600,
  );

  const authUrl = `https://${process.env["API_BASE_URL"]}/api/auth/github?state=${state}&platform=discord`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel("GitHub で連携する 🔗").setStyle(ButtonStyle.Link).setURL(authUrl),
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

async function handleMessage(message: Message): Promise<void> {
  // Bot 自身のメッセージは無視
  if (message.author.bot) return;

  // メンションされているか確認
  if (!discordClient.user || !message.mentions.has(discordClient.user)) return;

  const discordUserId = message.author.id;
  const text = message.content.replace(/<@!?\d+>/g, "").trim();

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
}

export function registerDiscordHandlers(): void {
  discordClient.on("messageCreate", (message) => {
    void handleMessage(message);
  });
}
