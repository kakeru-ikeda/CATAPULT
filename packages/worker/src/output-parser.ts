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
  for (const event of events) {
    if (event.type === "done" && event.prUrl) return event.prUrl;
    if (event.type === "shell" && event.stdout) {
      const match = event.stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
      if (match?.[0]) return match[0];
    }
  }
  return undefined;
}
