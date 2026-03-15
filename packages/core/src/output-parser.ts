import type { CopilotEvent } from "./types.js";

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
    // New Copilot CLI v1.x format
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
