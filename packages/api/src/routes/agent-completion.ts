const PR_URL_PATTERN = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
const SENDABLE_MESSAGE_PATTERN =
  /(?:^|\n)#{1,6}\s*送信用メッセージ\s*\n+([\s\S]*?)(?=\n#{1,6}\s+\S|\n---+\n?|$)/;

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

  let fallbackSummary: string | undefined;
  for (let index = assistantContents.length - 1; index >= 0; index--) {
    const content = assistantContents[index];
    if (!content) continue;
    const trimmedContent = content.trim();
    fallbackSummary ??= trimmedContent;
    const sendableMessage = extractSendableMessage(trimmedContent);
    if (sendableMessage) {
      return { prUrl, summary: sendableMessage };
    }
  }

  return {
    prUrl,
    summary: fallbackSummary ?? "タスクが完了しました",
  };
}

function extractSendableMessage(content: string): string | undefined {
  const match = content.match(SENDABLE_MESSAGE_PATTERN);
  const candidate = match?.[1]?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
}
