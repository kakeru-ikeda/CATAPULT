import { registerDiscordHandlers } from "./handlers/discord-mention.js";
import { registerInteractiveHandlers } from "./handlers/interactive.js";
import { handleMention } from "./handlers/mention.js";
import { registerOptionsHandlers } from "./handlers/options.js";
import { discordClient, startDiscord } from "./platforms/discord.js";
import { slackApp } from "./platforms/slack.js";

if (slackApp) {
  // app_mention イベント: メンション検知
  slackApp.event("app_mention", async ({ event, client }) => {
    await handleMention(event, client);
  });

  // external_select データソース登録
  registerOptionsHandlers(slackApp);

  // インタラクティブコンポーネント登録
  registerInteractiveHandlers(slackApp);
}

// Discord ハンドラー登録
registerDiscordHandlers();

// Slack & Discord アプリ起動
void (async () => {
  if (slackApp) {
    await slackApp.start();
    console.info("⚡️ CATAPULT Slack Bot is running (Socket Mode)");
  }
  await startDiscord();
  console.info("🤖 CATAPULT Discord Bot is running");
})();

async function shutdown(signal: string): Promise<void> {
  console.info(`Received ${signal}, shutting down...`);
  await Promise.allSettled([
    slackApp ? slackApp.stop() : Promise.resolve(),
    discordClient.destroy(),
  ]);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
