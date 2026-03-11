import type { Message } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import Redis from "ioredis";

import type { CopilotEvent } from "../formatters/slack-blocks.js";

// send() メソッドを持つチャンネルの最小インターフェース
interface SendableChannel {
  send(content: string | object): Promise<Message>;
}

const redis = new Redis(process.env["REDIS_URL"]!);

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export class DiscordJobStreamRelay {
  private subscriber: Redis | null = null;
  private finished = false;
  private progressMessage: Message | null = null;
  private editTimer: NodeJS.Timeout | null = null;

  // 進行状況インジケーター用の状態
  private stepCount = 0;
  private lastTool: string | null = null;
  private lastAssistantMessage: string | null = null;

  constructor(
    private readonly jobId: string,
    private readonly channel: SendableChannel,
    private readonly discordUserId: string,
  ) {}

  private buildStopRow(): ActionRowBuilder<ButtonBuilder> {
    const button = new ButtonBuilder()
      .setCustomId(`stop_job:${this.jobId}:${this.discordUserId}`)
      .setLabel("🛑 停止")
      .setStyle(ButtonStyle.Danger);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
  }

  async start(): Promise<void> {
    this.progressMessage = await this.channel.send({
      content: "⚙️ **作業中...**",
      components: [this.buildStopRow()],
    });

    // 停止ボタンのインタラクションをこのメッセージ内コレクターで受け付ける
    if (this.progressMessage && "createMessageComponentCollector" in this.progressMessage) {
      const collector = (this.progressMessage as Message<true>).createMessageComponentCollector({
        time: 2 * 60 * 60 * 1000,
      });
      collector.on("collect", (interaction) => {
        void (async () => {
          if (!interaction.isButton()) return;
          const parts = interaction.customId.split(":");
          if (parts[0] !== "stop_job" || parts[2] !== interaction.user.id) {
            await interaction.reply({ content: "権限がありません。", ephemeral: true });
            return;
          }
          await interaction.deferUpdate();
          await redis.publish(`job:${this.jobId}:cancel`, "cancel");
        })();
      });
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
        const summary = truncate(event.summary ?? "タスクが完了しました", 500);
        let text = `✅ **完了**: ${summary}`;
        if (event.prUrl) text += `\n[PR を開く](${event.prUrl})`;
        void this.editProgressMessage(text).then(() => this.cleanup());
        break;
      }
      case "error": {
        this.finished = true;
        if (this.editTimer) {
          clearTimeout(this.editTimer);
          this.editTimer = null;
        }
        void this.editProgressMessage(`❌ ${truncate(event.message ?? "Unknown error", 500)}`).then(
          () => this.cleanup(),
        );
        break;
      }
      case "cancelled": {
        this.finished = true;
        if (this.editTimer) {
          clearTimeout(this.editTimer);
          this.editTimer = null;
        }
        void this.editProgressMessage("🛑 キャンセルされました").then(() => this.cleanup());
        break;
      }
    }
  }

  private scheduleEdit(): void {
    if (this.editTimer || this.finished) return;
    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      void this.editProgressMessage(this.buildIndicatorText());
    }, 3000);
  }

  private buildIndicatorText(): string {
    let text = `⚙️ **作業中...** (ステップ ${this.stepCount})`;
    if (this.lastTool) text += `\n🔧 \`${this.lastTool}\``;
    if (this.lastAssistantMessage) text += `\n💬 ${this.lastAssistantMessage}`;
    return text;
  }

  private async editProgressMessage(content: string): Promise<void> {
    if (!this.progressMessage) return;
    try {
      // 終了時はボタンを削除、進行中はボタンを維持
      const editOptions = this.finished
        ? { content, components: [] }
        : { content, components: [this.buildStopRow()] };
      await this.progressMessage.edit(editOptions);
    } catch (err) {
      console.error(`DiscordJobStreamRelay: failed to edit message for job ${this.jobId}:`, err);
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
