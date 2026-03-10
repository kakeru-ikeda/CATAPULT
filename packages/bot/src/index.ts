import { registerInteractiveHandlers } from "./handlers/interactive.js";
import { handleMention } from "./handlers/mention.js";
import { registerOptionsHandlers } from "./handlers/options.js";
import { slackApp } from "./platforms/slack.js";

// app_mention イベント: メンション検知
slackApp.event("app_mention", async ({ event, client }) => {
  await handleMention(event, client);
});

// external_select データソース登録
registerOptionsHandlers(slackApp);

// インタラクティブコンポーネント登録
registerInteractiveHandlers(slackApp);

// Slack アプリ起動
void (async () => {
  await slackApp.start();
  console.info("⚡️ CATAPULT Slack Bot is running (Socket Mode)");
})();
