import type { App } from "@slack/bolt";
import Redis from "ioredis";

import { type CopilotEvent, formatEvent } from "../formatters/slack-blocks.js";

export class JobStreamRelay {
  private buffer: CopilotEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private subscriber: Redis | null = null;
  private finished = false;

  constructor(
    private readonly jobId: string,
    private readonly slack: App,
    private readonly channelId: string,
    private readonly threadTs: string,
  ) {}

  async start(): Promise<void> {
    this.subscriber = new Redis(process.env["REDIS_URL"]!);
    await this.subscriber.subscribe(`job:${this.jobId}`);

    this.subscriber.on("message", (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as CopilotEvent;
        this.buffer.push(event);
        this.scheduleFlush();

        // done or error イベントで完了処理
        if (event.type === "done" || event.type === "error") {
          this.finished = true;
          // 最終フラッシュを確実に実行
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
      .map(formatEvent)
      .filter((s) => s.length > 0)
      .join("\n");
    if (!text) return;

    try {
      await this.slack.client.chat.postMessage({
        channel: this.channelId,
        thread_ts: this.threadTs,
        text,
      });
    } catch (err) {
      console.error(`JobStreamRelay: failed to post message for job ${this.jobId}:`, err);
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
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.cleanup();
  }
}
