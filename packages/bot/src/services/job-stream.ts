import { PrismaClient } from "@prisma/client";
import type { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import Redis from "ioredis";

import type { CopilotEvent } from "../formatters/slack-blocks.js";
import { markdownToMrkdwn } from "../formatters/markdown-to-mrkdwn.js";

import {
  buildCanvasMarkdown,
  updateThreadCanvas,
  type JobCanvasContext,
  type CanvasProgressState,
  type PreviousJobSummary,
} from "./canvas-manager.js";

const prisma = new PrismaClient();

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

// メッセージモード用: Slack section block の文字数上限は 3000 文字
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
  private controlMessageTs: string | null = null;
  private canvasUpdateTimer: NodeJS.Timeout | null = null;

  // 進行状況インジケーター用の状態
  private stepCount = 0;
  private lastTool: string | null = null;
  private lastAssistantMessage: string | null = null;

  // 前ジョブ履歴（start() 時にDB から取得）
  private previousJobs: PreviousJobSummary[] = [];

  // canvasId が null のとき: メッセージモード（無料プランなど Canvas 非対応ワークスペース用）
  private readonly canvasMode: boolean;

  constructor(
    private readonly jobId: string,
    private readonly slack: App,
    private readonly channelId: string,
    private readonly threadTs: string,
    private readonly slackUserId: string,
    private readonly canvasId: string | null,
    private readonly canvasUrl: string | null,
    private readonly jobContext: JobCanvasContext | null,
  ) {
    this.canvasMode = !!canvasId;
  }

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
    if (this.canvasMode) {
      // Canvas モード: 前ジョブ履歴を取得して Canvas を初期化
      this.previousJobs = await this.loadPreviousJobs();
      await this.doCanvasUpdate({
        stepCount: 0,
        lastTool: null,
        lastAssistantMessage: null,
        isDone: false,
        isError: false,
        isCancelled: false,
        finalSummary: null,
        prUrl: null,
        errorMessage: null,
      });

      // コントロールメッセージ（停止ボタン + Canvas リンク）をスレッドに投稿
      const result = await this.slack.client.chat.postMessage({
        channel: this.channelId,
        thread_ts: this.threadTs,
        text: `⚙️ 作業中... → ${this.canvasUrl}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `⚙️ 作業中... → <${this.canvasUrl}|📄 Canvas で進捗確認>`,
            },
          },
          this.buildStopButton(),
        ],
      });
      this.controlMessageTs = result.ts ?? null;
    } else {
      // メッセージモード（Canvas 非対応ワークスペース）: 従来どおり進捗メッセージを投稿
      const result = await this.slack.client.chat.postMessage({
        channel: this.channelId,
        thread_ts: this.threadTs,
        text: "⚙️ 作業中...",
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: "⚙️ 作業中..." } },
          this.buildStopButton(),
        ],
      });
      this.controlMessageTs = result.ts ?? null;
    }

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
        this.scheduleUpdate();
        break;
      }
      case "assistant.message": {
        const content = event.data?.content;
        if (typeof content === "string" && content.trim()) {
          this.lastAssistantMessage = truncate(content, 200);
        }
        this.scheduleUpdate();
        break;
      }
      case "done": {
        this.finished = true;
        if (this.canvasUpdateTimer) {
          clearTimeout(this.canvasUpdateTimer);
          this.canvasUpdateTimer = null;
        }
        const summary = event.summary ?? "タスクが完了しました";
        const prUrl = event.prUrl ?? null;
        if (this.canvasMode) {
          void this.doCanvasUpdate({
            stepCount: this.stepCount,
            lastTool: this.lastTool,
            lastAssistantMessage: this.lastAssistantMessage,
            isDone: true,
            isError: false,
            isCancelled: false,
            finalSummary: summary,
            prUrl,
            errorMessage: null,
          })
            .then(() => this.updateControlMessage("done", prUrl))
            .then(() => this.cleanup());
        } else {
          const fullSummary = prUrl
            ? `${summary}\n\n🔀 *作成された PR:* <${prUrl}|PR を開く>`
            : summary;
          void this.updateProgressMessage("✅ *完了*")
            .then(() => this.postSummaryMessage(fullSummary))
            .then(() => this.cleanup());
        }
        break;
      }
      case "error": {
        this.finished = true;
        if (this.canvasUpdateTimer) {
          clearTimeout(this.canvasUpdateTimer);
          this.canvasUpdateTimer = null;
        }
        const errorMsg = event.message ?? "Unknown error";
        if (this.canvasMode) {
          void this.doCanvasUpdate({
            stepCount: this.stepCount,
            lastTool: this.lastTool,
            lastAssistantMessage: this.lastAssistantMessage,
            isDone: false,
            isError: true,
            isCancelled: false,
            finalSummary: null,
            prUrl: null,
            errorMessage: errorMsg,
          })
            .then(() => this.updateControlMessage("error"))
            .then(() => this.cleanup());
        } else {
          void this.updateProgressMessage(`❌ ${truncate(errorMsg, 500)}`).then(() =>
            this.cleanup(),
          );
        }
        break;
      }
      case "cancelled": {
        this.finished = true;
        if (this.canvasUpdateTimer) {
          clearTimeout(this.canvasUpdateTimer);
          this.canvasUpdateTimer = null;
        }
        if (this.canvasMode) {
          void this.doCanvasUpdate({
            stepCount: this.stepCount,
            lastTool: this.lastTool,
            lastAssistantMessage: this.lastAssistantMessage,
            isDone: false,
            isError: false,
            isCancelled: true,
            finalSummary: null,
            prUrl: null,
            errorMessage: null,
          })
            .then(() => this.updateControlMessage("cancelled"))
            .then(() => this.cleanup());
        } else {
          void this.updateProgressMessage("🛑 キャンセルされました").then(() => this.cleanup());
        }
        break;
      }
    }
  }

  /** 3 秒スロットリングで Canvas またはメッセージを更新するスケジューラー */
  private scheduleUpdate(): void {
    if (this.canvasUpdateTimer || this.finished) return;
    this.canvasUpdateTimer = setTimeout(() => {
      this.canvasUpdateTimer = null;
      if (this.canvasMode) {
        void this.doCanvasUpdate({
          stepCount: this.stepCount,
          lastTool: this.lastTool,
          lastAssistantMessage: this.lastAssistantMessage,
          isDone: false,
          isError: false,
          isCancelled: false,
          finalSummary: null,
          prUrl: null,
          errorMessage: null,
        });
      } else {
        void this.updateProgressMessage(this.buildIndicatorText());
      }
    }, 3000);
  }

  /** Canvas 全体を現在の進捗で更新する（Canvas モード専用） */
  private async doCanvasUpdate(progress: CanvasProgressState): Promise<void> {
    if (!this.canvasId || !this.jobContext) return;
    try {
      const markdown = buildCanvasMarkdown(this.previousJobs, this.jobContext, progress);
      await updateThreadCanvas(this.canvasId, markdown, this.slack.client);
    } catch (err) {
      console.error(`JobStreamRelay: failed to update canvas for job ${this.jobId}:`, err);
    }
  }

  /** コントロールメッセージ（停止ボタン付き）を最終状態に更新する（Canvas モード専用） */
  private async updateControlMessage(
    status: "done" | "error" | "cancelled",
    prUrl?: string | null,
  ): Promise<void> {
    if (!this.controlMessageTs) return;
    let text: string;
    if (status === "done") {
      text = prUrl
        ? `✅ 完了 → <${this.canvasUrl}|📄 Canvas で結果確認> | 🔀 <${prUrl}|PR を開く>`
        : `✅ 完了 → <${this.canvasUrl}|📄 Canvas で結果確認>`;
    } else if (status === "error") {
      text = `❌ エラーが発生しました → <${this.canvasUrl}|📄 Canvas で詳細確認>`;
    } else {
      text = `🛑 キャンセルされました → <${this.canvasUrl}|📄 Canvas で確認>`;
    }
    try {
      await this.slack.client.chat.update({
        channel: this.channelId,
        ts: this.controlMessageTs,
        text,
        blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
      });
    } catch (err) {
      console.error(`JobStreamRelay: failed to update control message for job ${this.jobId}:`, err);
    }
  }

  /** 進捗インジケーターテキストを構築する（メッセージモード専用） */
  private buildIndicatorText(): string {
    let text = `⚙️ 作業中... (ステップ ${this.stepCount})`;
    if (this.lastTool) text += `\n🔧 \`${this.lastTool}\``;
    if (this.lastAssistantMessage) text += `\n💬 ${this.lastAssistantMessage}`;
    return text;
  }

  /** 進捗メッセージを更新する（メッセージモード専用） */
  private async updateProgressMessage(text: string): Promise<void> {
    if (!this.controlMessageTs) return;
    try {
      const updateOptions = this.finished
        ? { channel: this.channelId, ts: this.controlMessageTs, text, blocks: [] as KnownBlock[] }
        : {
            channel: this.channelId,
            ts: this.controlMessageTs,
            text,
            blocks: [
              { type: "section" as const, text: { type: "mrkdwn" as const, text } },
              this.buildStopButton(),
            ],
          };
      await this.slack.client.chat.update(updateOptions);
    } catch (err) {
      console.error(`JobStreamRelay: failed to update message for job ${this.jobId}:`, err);
    }
  }

  /** サマリーメッセージを投稿する（メッセージモード専用） */
  private async postSummaryMessage(summary: string): Promise<void> {
    const mrkdwn = markdownToMrkdwn(summary);
    const chunks = splitIntoChunks(mrkdwn, SLACK_BLOCK_MAX);
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

  /** 同一スレッドの前ジョブ（直近3件）を DB から取得する */
  private async loadPreviousJobs(): Promise<PreviousJobSummary[]> {
    try {
      const jobs = await prisma.job.findMany({
        where: {
          threadId: this.threadTs,
          channelId: this.channelId,
          status: "COMPLETED",
          NOT: { id: this.jobId },
        },
        orderBy: { completedAt: "desc" },
        take: 3,
        select: {
          prompt: true,
          repository: true,
          branch: true,
          completedAt: true,
          resultSummary: true,
          prUrl: true,
        },
      });
      // 古い順に並べ直す（Canvas上部が古い→下部が新しい）
      return jobs
        .reverse()
        .filter((j) => j.completedAt !== null)
        .map((j) => ({
          task: j.prompt,
          repo: j.repository,
          branch: j.branch,
          completedAt: j.completedAt!,
          resultSummary: j.resultSummary,
          prUrl: j.prUrl,
        }));
    } catch {
      return [];
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
    if (this.canvasUpdateTimer) {
      clearTimeout(this.canvasUpdateTimer);
      this.canvasUpdateTimer = null;
    }
    this.cleanup();
  }
}
