import type { CopilotEvent } from "./executor.js";

const SENDABLE_MESSAGE_PATTERN =
  /(?:^|\n)#{1,6}\s*送信用メッセージ\s*\n+([\s\S]*?)(?=\n#{1,6}\s+\S|\n---+\n?|$)/;

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
  const assistantContents = events.filter(
    (event): event is CopilotEvent & { data: { content: string } } =>
      event.type === "assistant.message" &&
      typeof event.data?.content === "string" &&
      event.data.content.trim().length > 0,
  );

  let fallback: string | undefined;

  for (let index = assistantContents.length - 1; index >= 0; index--) {
    const event = assistantContents[index];
    if (!event) continue;
    const content = event.data.content.trim();
    fallback ??= content;
    const sendableMessage = extractSendableMessage(content);
    if (sendableMessage) {
      return sendableMessage;
    }
  }

  return fallback;
}

function extractSendableMessage(content: string): string | undefined {
  const match = content.match(SENDABLE_MESSAGE_PATTERN);
  const candidate = match?.[1]?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
}
