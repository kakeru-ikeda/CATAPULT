import { sanitizeSummary } from "../utils/summary-sanitizer.js";

const PR_URL_PATTERN = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
const WORKER_BRANCH_PATTERN = /copilot\/job-[a-z0-9]{8}\/[\w./-]+/;

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
  workerBranch?: string;
  summary: string;
} {
  let prUrl: string | undefined;
  let workerBranch: string | undefined;
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
      // 標準出力から作業ブランチ名を抽出
      const raw = log.content;
      const branchMatch = raw.match(WORKER_BRANCH_PATTERN);
      if (branchMatch) {
        workerBranch = branchMatch[0];
      }
    } catch {
      // パース失敗は無視
    }
  }

  return {
    prUrl,
    workerBranch,
    summary: sanitizeSummary(assistantContents.at(-1) ?? "タスクが完了しました"),
  };
}
