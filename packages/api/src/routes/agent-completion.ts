const PR_URL_PATTERN = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

interface JobLogRecord {
  eventType: string;
  content: string;
}

interface ParsedLogEvent {
  prUrl?: string;
  data?: { content?: string };
}

export function extractCompletionFromLogs(logs: JobLogRecord[]): {
  prUrl?: string;
  summary: string;
} {
  let prUrl: string | undefined;
  const assistantContents: string[] = [];

  for (const log of logs) {
    try {
      const event = JSON.parse(log.content) as ParsedLogEvent;

      if (event.prUrl) {
        prUrl = event.prUrl;
      } else if (
        log.eventType === "assistant.message" &&
        typeof event.data?.content === "string" &&
        event.data.content.trim()
      ) {
        assistantContents.push(event.data.content);
        const match = event.data.content.match(PR_URL_PATTERN);
        if (match) {
          prUrl = match[0];
        }
      }
    } catch {
      // パース失敗は無視
    }
  }

  return {
    prUrl,
    summary: assistantContents.at(-1) ?? "タスクが完了しました",
  };
}
