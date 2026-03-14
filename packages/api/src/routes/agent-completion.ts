const PR_URL_PATTERN = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
const PR_URL_GLOBAL_PATTERN = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/gu;

interface JobLogRecord {
  eventType: string;
  content: string;
}

interface ParsedLogEvent {
  prUrl?: string;
  data?: { content?: string };
}

function normalizeRepository(repository: string): string {
  return repository
    .trim()
    .replace(/\.git$/u, "")
    .toLowerCase();
}

function isExpectedPrUrl(prUrl: string, repository?: string): boolean {
  if (!repository) return true;
  const capturedRepository = prUrl.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+$/u,
  )?.[1];
  return (
    capturedRepository !== undefined &&
    capturedRepository.toLowerCase() === normalizeRepository(repository)
  );
}

function findExpectedPrUrl(content: string, repository?: string): string | undefined {
  if (!repository) {
    return content.match(PR_URL_PATTERN)?.[0];
  }

  for (const match of content.matchAll(PR_URL_GLOBAL_PATTERN)) {
    if (match[0] && isExpectedPrUrl(match[0], repository)) {
      return match[0];
    }
  }

  return undefined;
}

export function extractCompletionFromLogs(
  logs: JobLogRecord[],
  repository?: string,
): {
  prUrl?: string;
  summary: string;
} {
  let prUrl: string | undefined;
  const assistantContents: string[] = [];

  for (const log of logs) {
    try {
      const event = JSON.parse(log.content) as ParsedLogEvent;

      if (event.prUrl && isExpectedPrUrl(event.prUrl, repository)) {
        prUrl = event.prUrl;
      } else if (
        log.eventType === "assistant.message" &&
        typeof event.data?.content === "string" &&
        event.data.content.trim()
      ) {
        assistantContents.push(event.data.content);
        const matchedPrUrl = findExpectedPrUrl(event.data.content, repository);
        if (matchedPrUrl) {
          prUrl = matchedPrUrl;
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
