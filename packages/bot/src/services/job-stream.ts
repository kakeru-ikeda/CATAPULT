import type { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import Redis from "ioredis";

import type { CopilotEvent } from "../formatters/slack-blocks.js";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

// Slack section block の文字数上限は 3000 文字
const SLACK_BLOCK_MAX = 2950;

function splitIntoChunks(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";
  for (const line of lines) {
    const addition = current ? "\n" + line : line;
    if ((current + addition).length > maxLength) {
      if (current) chunks.push(current);
      current = line.length > maxLength ? line.slice(0, maxLength) : line;
    } else {
      current = current + addition;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export class JobStreamRelay {
  private subscriber: Redis | null = null;
  private finished = false;
  private progressMessageTs: string | null = null;
  private editTimer: NodeJS.Timeout | null = null;

  // 進行状況インジケーター用の状態
  private stepCount = 0;
  private lastTool: string | null = null;
  private lastAssistantMessage: string | null = null;

  constructor(
    private readonly jobId: string,
    private readonly slack: App,
    private readonly channelId: string,
    private readonly threadTs: string,
    private readonly slackUserId: string,
  ) {}

  private buildStopButton(): KnownBlock {
    return {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "🛑 停止" },
          style: "danger",
          action_id: "stop_job",
          value: `${this.jobId}:${this.slackUserId}`,
        },
      ],
    };
  }

  async start(): Promise<void> {
    const result = await this.slack.client.chat.postMessage({
      channel: this.channelId,
      thread_ts: this.threadTs,
      text: "⚙️ 作業中...",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "⚙️ 作業中..." } },
        this.buildStopButton(),
      ],
    });
    this.progressMessageTs = result.ts ?? null;

    this.subscriber = new Redis(process.env["REDIS_URL"]!);
    await this.subscriber.subscribe(`job:${this.jobId}`);

    this.subscriber.on("message", (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as CopilotEvent;
        this.handleEvent(event);
      } catch {
        // JSON パースエラーは無視
      }
    });
  }

  private handleEvent(event: CopilotEvent): void {
    if (this.finished) return;

    switch (event.type) {
      case "tool.execution_start": {
        const toolName = event.data?.toolName;
        if (toolName === "bash" || toolName === "shell") {
          const args = event.data?.arguments as
            | { description?: string; command?: string }
            | undefined;
          const desc =
            args?.description ?? (args?.command ? truncate(args.command, 100) : undefined);
          if (desc) this.lastTool = desc;
        }
        this.stepCount++;
        this.scheduleEdit();
        break;
      }
      case "assistant.message": {
        const content = event.data?.content;
        if (typeof content === "string" && content.trim()) {
          this.lastAssistantMessage = truncate(content, 200);
        }
        this.scheduleEdit();
        break;
      }
      case "done": {
        this.finished = true;
        if (this.editTimer) {
          clearTimeout(this.editTimer);
          this.editTimer = null;
        }
        let statusText = "✅ *完了*";
        if (event.prUrl) statusText += `\n<${event.prUrl}|PR を開く>`;
        void this.updateProgressMessage(statusText).then(async () => {
          const summary = event.summary ?? "タスクが完了しました";
          const fullSummary = event.prUrl
            ? `${summary}\n\n🔀 *作成された PR:* <${event.prUrl}|PR を開く>`
            : summary;
          await this.postSummaryMessage(fullSummary);
          this.cleanup();
        });
        break;
      }
      case "error": {
        this.finished = true;
        if (this.editTimer) {
          clearTimeout(this.editTimer);
          this.editTimer = null;
        }
        void this.updateProgressMessage(
          `❌ ${truncate(event.message ?? "Unknown error", 500)}`,
        ).then(() => this.cleanup());
        break;
      }
      case "cancelled": {
        this.finished = true;
        if (this.editTimer) {
          clearTimeout(this.editTimer);
          this.editTimer = null;
        }
        void this.updateProgressMessage("🛑 キャンセルされました").then(() => this.cleanup());
        break;
      }
    }
  }

  private scheduleEdit(): void {
    if (this.editTimer || this.finished) return;
    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      void this.updateProgressMessage(this.buildIndicatorText());
    }, 3000);
  }

  private buildIndicatorText(): string {
    let text = `⚙️ 作業中... (ステップ ${this.stepCount})`;
    if (this.lastTool) text += `\n🔧 \`${this.lastTool}\``;
    if (this.lastAssistantMessage) text += `\n💬 ${this.lastAssistantMessage}`;
    return text;
  }

  private async postSummaryMessage(summary: string): Promise<void> {
    const chunks = splitIntoChunks(summary, SLACK_BLOCK_MAX);
    for (const chunk of chunks) {
      try {
        await this.slack.client.chat.postMessage({
          channel: this.channelId,
          thread_ts: this.threadTs,
          text: chunk,
          blocks: [{ type: "section", text: { type: "mrkdwn", text: chunk } }],
        });
      } catch (err) {
        console.error(`JobStreamRelay: failed to post summary chunk for job ${this.jobId}:`, err);
      }
    }
  }

  private async updateProgressMessage(text: string): Promise<void> {
    if (!this.progressMessageTs) return;
    try {
      // 終了済み（完了・エラー・キャンセル）の場合はボタンを削除、進行中はボタンを維持
      const updateOptions = this.finished
        ? { channel: this.channelId, ts: this.progressMessageTs, text, blocks: [] }
        : {
            channel: this.channelId,
            ts: this.progressMessageTs,
            text,
            blocks: [{ type: "section", text: { type: "mrkdwn", text } }, this.buildStopButton()],
          };
      await this.slack.client.chat.update(updateOptions);
    } catch (err) {
      console.error(`JobStreamRelay: failed to update message for job ${this.jobId}:`, err);
    }
  }

  private cleanup(): void {
    if (this.subscriber) {
      void this.subscriber.unsubscribe(`job:${this.jobId}`).then(() => {
        this.subscriber?.disconnect();
        this.subscriber = null;
      });
    }
  }

  stop(): void {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }
    this.cleanup();
  }
}
