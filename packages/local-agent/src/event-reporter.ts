import type { AgentConfig } from "./config.js";

export interface JobEvent {
  type: string;
  data?: unknown;
  timestamp: string;
  [key: string]: unknown; // prUrl, summary など workerが送るトップレベルフィールドを許容
}

export class EventReporter {
  private buffer: JobEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_INTERVAL_MS = 500;

  constructor(
    private readonly jobId: string,
    private readonly config: AgentConfig,
  ) {}

  report(event: JobEvent): void {
    this.buffer.push(event);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        void this.flush();
      }, this.FLUSH_INTERVAL_MS);
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    await this.postEvents(events);
  }

  private async postEvents(events: JobEvent[]): Promise<void> {
    try {
      const res = await fetch(`${this.config.apiUrl}/api/agents/jobs/${this.jobId}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.agentToken}`,
        },
        body: JSON.stringify({ events }),
      });
      if (!res.ok) {
        console.warn(`[EventReporter] Failed to post events: ${res.status}`);
      }
    } catch (err) {
      console.warn("[EventReporter] Network error:", err);
    }
  }
}
