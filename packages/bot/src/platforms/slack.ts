import { App, LogLevel } from "@slack/bolt";

export const slackApp = new App({
  token: process.env["SLACK_BOT_TOKEN"]!,
  signingSecret: process.env["SLACK_SIGNING_SECRET"]!,
  socketMode: true,
  appToken: process.env["SLACK_APP_TOKEN"]!,
  logLevel: LogLevel.INFO,
});
