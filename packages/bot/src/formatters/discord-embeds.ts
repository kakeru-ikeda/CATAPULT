import type { CopilotEvent } from "./slack-blocks.js";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export function splitIntoChunks(text: string, maxLength = 1900): string[] {
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

export function formatDiscordEvent(event: CopilotEvent): string {
  switch (event.type) {
    case "agent_step":
      return `💭 ${event.content ?? ""}`;
    case "tool_call":
      return `🔧 **${event.tool ?? "unknown"}**: \`${truncate(JSON.stringify(event.input), 100)}\``;
    case "shell": {
      const stdout = truncate(event.stdout ?? "", 200);
      return `📟 \`${event.command ?? ""}\`${stdout ? `\n\`\`\`\n${stdout}\n\`\`\`` : ""}`;
    }
    case "file_edit":
      return `📝 ${event.path ?? ""}`;
    case "error":
      return `❌ ${event.message ?? "Unknown error"}`;
    case "done":
      return `✅ **完了**: ${event.summary ?? ""}${event.prUrl ? `\n[PR を開く](${event.prUrl})` : ""}`;
    default:
      return "";
  }
}
