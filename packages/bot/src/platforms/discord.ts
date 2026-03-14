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

export async function startDiscord(): Promise<boolean> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    console.warn("DISCORD_BOT_TOKEN not set, Discord bot disabled");
    return false;
  }
  await discordClient.login(token);
  return true;
}
