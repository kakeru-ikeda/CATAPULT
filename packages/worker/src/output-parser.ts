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
  const prUrlPattern = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/u;
  const prUrlGlobalPattern = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/gu;

  if (!repository) {
    return content.match(prUrlPattern)?.[0];
  }

  for (const match of content.matchAll(prUrlGlobalPattern)) {
    if (match[0] && isExpectedPrUrl(match[0], repository)) {
      return match[0];
    }
  }

  return undefined;
}

export function extractPrUrl(events: CopilotEvent[], repository?: string): string | undefined {
  for (const event of events) {
    // Legacy format
    if (event.type === "done" && event.prUrl && isExpectedPrUrl(event.prUrl, repository)) {
      return event.prUrl;
    }
    if (event.type === "shell" && event.stdout) {
      const matchedPrUrl = findExpectedPrUrl(event.stdout, repository);
      if (matchedPrUrl) return matchedPrUrl;
    }
    // New Copilot CLI v1.x format: scan tool result and assistant message content
    if (event.data?.result?.content) {
      const matchedPrUrl = findExpectedPrUrl(event.data.result.content, repository);
      if (matchedPrUrl) return matchedPrUrl;
    }
    if (event.type === "assistant.message" && typeof event.data?.content === "string") {
      const matchedPrUrl = findExpectedPrUrl(event.data.content, repository);
      if (matchedPrUrl) return matchedPrUrl;
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
