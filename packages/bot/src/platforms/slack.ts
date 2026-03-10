import { App, LogLevel } from "@slack/bolt";

function createSlackApp(): App | null {
  const token = process.env["SLACK_BOT_TOKEN"];
  const signingSecret = process.env["SLACK_SIGNING_SECRET"];
  const appToken = process.env["SLACK_APP_TOKEN"];
  if (!token || !signingSecret || !appToken) {
    console.warn("Slack tokens not set, Slack bot disabled");
    return null;
  }
  return new App({
    token,
    signingSecret,
    socketMode: true,
    appToken,
    logLevel: LogLevel.INFO,
  });
}

export const slackApp = createSlackApp();
