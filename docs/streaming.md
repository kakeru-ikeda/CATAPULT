# CATAPULT - ストリーミング設計

## 概要

Copilot CLI の `--output json` オプションを使用して NDJSON (Newline Delimited JSON) 形式のイベントストリームを取得し、リアルタイムで Slack/Discord に投稿します。

## NDJSON イベントストリーム

Copilot CLI は `--output json` オプション指定時に、stdout に NDJSON 形式でイベントを出力します。各行が1つの JSON オブジェクトです。

```
{"type":"agent_step","content":"リポジトリをクローンします..."}
{"type":"tool_call","tool":"bash","input":"git clone ..."}
{"type":"shell","command":"git clone https://github.com/...", "stdout":"Cloning into...", "stderr":""}
{"type":"file_edit","path":"src/index.ts","diff":"..."}
{"type":"thinking","content":"次のステップを検討中..."}
{"type":"done","summary":"PR #42 を作成しました", "prUrl":"https://github.com/..."}
```

## イベント型一覧

| イベント型   | 説明                      | 通知内容         | Slack/Discord 表示     |
| ------------ | ------------------------- | ---------------- | ---------------------- |
| `agent_step` | 思考・計画ステップ        | ステータス更新   | 💭 \<content\>         |
| `tool_call`  | ツール呼び出し            | ツール実行通知   | 🔧 \<tool\>: \<input\> |
| `shell`      | シェルコマンド実行        | コマンド実行ログ | 📟 `\<command\>`       |
| `file_edit`  | ファイル変更（diff 付き） | 変更差分表示     | 📝 \<path\>            |
| `thinking`   | 内部推論                  | **非表示**       | -                      |
| `error`      | エラー発生                | エラー通知       | ❌ \<message\>         |
| `done`       | 完了 + サマリー           | 完了通知         | ✅ \<summary\>         |

最終的に Slack/Discord へ送る完了報告の品質を安定させるため、Copilot CLI の最後の `assistant.message` には `## 送信用メッセージ` セクションを含めます。Worker / local-agent はこのセクションを優先して `done.summary` に採用し、セクションが無い場合のみ最後の `assistant.message` 全体をフォールバックとして使用します。

## パイプライン設計

```
Copilot CLI stdout (NDJSON)
         ↓
Worker: readline で行ごとにパース
         ↓
EventEmitter でイベント配信
         ↓
Redis Pub/Sub (channel: job:<jobId>)
         ↓
Bot (Slack/Discord): Pub/Sub 購読
         ↓
バッファリング（2秒間隔でまとめて投稿）
         ↓
Slack/Discord スレッドに投稿
```

## Worker 側の実装

```typescript
// executor.ts

import { createInterface } from "readline";
import { EventEmitter } from "events";
import { spawn } from "child_process";

export class CopilotExecutor extends EventEmitter {
  async execute(options: ExecuteOptions): Promise<void> {
    const proc = spawn(
      "copilot",
      ["--autopilot", "--allow-all", "--output", "json", "-p", options.prompt],
      {
        cwd: options.workDir,
        env: {
          ...process.env,
          GITHUB_TOKEN: options.githubToken,
        },
      },
    );

    const rl = createInterface({ input: proc.stdout });

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as CopilotEvent;
        this.emit("event", event);
      } catch {
        // パースエラーは無視
      }
    });

    return new Promise((resolve, reject) => {
      proc.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Copilot CLI exited with code ${code}`));
      });
    });
  }
}
```

## Redis Pub/Sub によるイベント配信

```typescript
// job-processor.ts

executor.on("event", async (event: CopilotEvent) => {
  // thinking イベントは配信・保存しない
  if (event.type === "thinking") return;

  // Redis Pub/Sub に配信
  await redis.publish(`job:${jobId}`, JSON.stringify(event));

  // DB に永続化
  await prisma.jobLog.create({
    data: {
      jobId,
      eventType: event.type,
      content: JSON.stringify(event),
    },
  });
});
```

## Bot 側のストリーミング受信（JobStreamRelay）

```typescript
// job-stream.ts

export class JobStreamRelay {
  private buffer: CopilotEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly jobId: string,
    private readonly slack: App,
    private readonly channelId: string,
    private readonly threadTs: string,
  ) {}

  async start(): Promise<void> {
    const subscriber = redis.duplicate();
    await subscriber.subscribe(`job:${this.jobId}`);

    subscriber.on("message", (_channel, message) => {
      const event = JSON.parse(message) as CopilotEvent;
      this.buffer.push(event);
      this.scheduleFlush();
    });
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    // 2秒間隔でまとめて投稿（Slack レートリミット対策）
    this.flushTimer = setTimeout(() => {
      this.flush();
      this.flushTimer = null;
    }, 2000);
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    const text = events.map(formatEvent).join("\n");

    await this.slack.client.chat.postMessage({
      channel: this.channelId,
      thread_ts: this.threadTs,
      text,
    });
  }
}
```

## イベントのフォーマット

### Slack 向けフォーマット

```typescript
// slack-blocks.ts

function formatEvent(event: CopilotEvent): string {
  switch (event.type) {
    case "agent_step":
      return `💭 ${event.content}`;
    case "tool_call":
      return `🔧 *${event.tool}*: \`${truncate(JSON.stringify(event.input), 100)}\``;
    case "shell":
      const stdout = truncate(event.stdout ?? "", 200);
      return `📟 \`${event.command}\`${stdout ? `\n\`\`\`\n${stdout}\n\`\`\`` : ""}`;
    case "file_edit":
      return `📝 ${event.path}`;
    case "error":
      return `❌ ${event.message}`;
    case "done":
      return `✅ *完了*: ${event.summary}${event.prUrl ? `\n<${event.prUrl}|PR を開く>` : ""}`;
    default:
      return "";
  }
}
```

### Discord 向けフォーマット

Discord は2000文字制限があるため、自動チャンク分割を行います。

```typescript
// discord-embeds.ts

function splitIntoChunks(text: string, maxLength = 1900): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
```

## ReactAdmin 向け SSE エンドポイント

ReactAdmin の LogViewer コンポーネントは SSE (Server-Sent Events) でリアルタイムログを受信します。

```typescript
// routes/jobs.ts

router.get("/:jobId/stream", authMiddleware, async (req, res) => {
  const { jobId } = req.params;

  // SSE ヘッダー設定
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // 既存ログを送信
  const logs = await prisma.jobLog.findMany({
    where: { jobId },
    orderBy: { timestamp: "asc" },
  });

  for (const log of logs) {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  }

  // Redis Pub/Sub で新着イベントをリアルタイム配信
  const subscriber = redis.duplicate();
  await subscriber.subscribe(`job:${jobId}`);

  subscriber.on("message", (_channel, message) => {
    res.write(`data: ${message}\n\n`);
  });

  req.on("close", () => {
    subscriber.unsubscribe();
    subscriber.quit();
  });
});
```

## バッファリング設計

Slack のレートリミット（1メッセージ/秒）に対応するため、2秒間のバッファリングを行います。

| プラットフォーム | バッファリング間隔 | 文字数制限          | 対応策           |
| ---------------- | ------------------ | ------------------- | ---------------- |
| Slack            | 2秒                | 3000文字/メッセージ | まとめて1投稿    |
| Discord          | 2秒                | 2000文字/メッセージ | 自動チャンク分割 |

## shell イベントの出力制限

`shell` イベントの stdout/stderr は200文字で切り詰めます（非常に長いコマンド出力を防ぐため）。

```typescript
const stdout = truncate(event.stdout ?? "", 200);
```

## DB への永続化

`thinking` イベントを除く全イベントを `JobLog` テーブルに保存します。

| イベント型   | DB 保存 | 理由                                  |
| ------------ | ------- | ------------------------------------- |
| `agent_step` | ✅      | 作業の記録として保存                  |
| `tool_call`  | ✅      | 監査ログとして保存                    |
| `shell`      | ✅      | コマンド実行履歴として保存            |
| `file_edit`  | ✅      | 変更ファイルの記録として保存          |
| `thinking`   | ❌      | 内部推論は保存不要・データ量節約      |
| `error`      | ✅      | エラー調査のために保存                |
| `done`       | ✅      | 完了サマリー・PR URL の記録として保存 |
