import type { CopilotEvent } from "./executor.js";

export function parseCopilotEvent(line: string): CopilotEvent | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>)["type"] !== "string"
    ) {
      return null;
    }
    return parsed as CopilotEvent;
  } catch {
    return null;
  }
}

export function extractPrUrl(events: CopilotEvent[]): string | undefined {
  const PR_URL_PATTERN = /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/;
  for (const event of events) {
    // Legacy format
    if (event.type === "done" && event.prUrl) return event.prUrl;
    if (event.type === "shell" && event.stdout) {
      const match = event.stdout.match(PR_URL_PATTERN);
      if (match?.[0]) return match[0];
    }
    // New Copilot CLI v1.x format: scan tool result and assistant message content
    if (event.data?.result?.content) {
      const match = event.data.result.content.match(PR_URL_PATTERN);
      if (match?.[0]) return match[0];
    }
    if (event.type === "assistant.message" && typeof event.data?.content === "string") {
      const match = event.data.content.match(PR_URL_PATTERN);
      if (match?.[0]) return match[0];
    }
  }
  return undefined;
}

export function extractFinalAssistantMessage(events: CopilotEvent[]): string | undefined {
  const assistantContents = events
    .filter(
      (event): event is CopilotEvent & { data: { content: string } } =>
        event.type === "assistant.message" &&
        typeof event.data?.content === "string" &&
        event.data.content.trim().length > 0,
    )
    .map((event) => event.data.content);

  return assistantContents.at(-1);
}

const FINAL_ANSWER_PATTERN =
  /<!--\s*FINAL_ANSWER_START\s*-->([\s\S]*?)<!--\s*FINAL_ANSWER_END\s*-->/;

/**
 * assistant.message イベント群から <!-- FINAL_ANSWER_START/END --> マーカーで囲まれた
 * ユーザー向け最終回答を抽出する。マーカーが見つからない場合は undefined を返す。
 */
export function extractFinalAnswer(events: CopilotEvent[]): string | undefined {
  // 全 assistant.message を結合してマーカーを探す（複数イベントにまたがる可能性を考慮）
  const allContent = events
    .filter(
      (event): event is CopilotEvent & { data: { content: string } } =>
        event.type === "assistant.message" &&
        typeof event.data?.content === "string" &&
        event.data.content.trim().length > 0,
    )
    .map((event) => event.data.content)
    .join("\n");

  const match = allContent.match(FINAL_ANSWER_PATTERN);
  return match?.[1]?.trim() || undefined;
}
