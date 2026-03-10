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

export async function startDiscord(): Promise<void> {
  await discordClient.login(process.env["DISCORD_BOT_TOKEN"]);
}
