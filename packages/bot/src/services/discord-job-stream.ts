import type { Message } from "discord.js";
import Redis from "ioredis";

import { formatDiscordEvent, splitIntoChunks } from "../formatters/discord-embeds.js";
import type { CopilotEvent } from "../formatters/slack-blocks.js";

// send() メソッドを持つチャンネルの最小インターフェース
interface SendableChannel {
  send(content: string): Promise<Message>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DiscordJobStreamRelay {
  private buffer: CopilotEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private subscriber: Redis | null = null;
  private finished = false;

  constructor(
    private readonly jobId: string,
    private readonly channel: SendableChannel,
  ) {}

  async start(): Promise<void> {
    this.subscriber = new Redis(process.env["REDIS_URL"]!);
    await this.subscriber.subscribe(`job:${this.jobId}`);

    this.subscriber.on("message", (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as CopilotEvent;
        this.buffer.push(event);
        this.scheduleFlush();

        if (event.type === "done" || event.type === "error") {
          this.finished = true;
          if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
          }
          void this.flush().then(() => this.cleanup());
        }
      } catch {
        // JSON パースエラーは無視
      }
    });
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.finished) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 2000);
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    const text = events
      .map(formatDiscordEvent)
      .filter((s) => s.length > 0)
      .join("\n");
    if (!text) return;

    const chunks = splitIntoChunks(text);
    for (const chunk of chunks) {
      try {
        await this.channel.send(chunk);
        if (chunks.length > 1) {
          await sleep(1000); // レートリミット対策
        }
      } catch (err) {
        console.error(`DiscordJobStreamRelay: failed to send message for job ${this.jobId}:`, err);
      }
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
}
