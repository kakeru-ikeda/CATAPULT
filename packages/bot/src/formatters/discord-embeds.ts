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
  switch (
    event.type // New Copilot CLI v1.x format
  ) {
    case "assistant.message": {
      const content = event.data?.content;
      if (typeof content === "string" && content.trim()) return `💬 ${content}`;
      return "";
    }
    case "tool.execution_start": {
      const toolName = event.data?.toolName;
      if (toolName === "bash" || toolName === "shell") {
        const args = event.data?.arguments as
          | { description?: string; command?: string }
          | undefined;
        const desc = args?.description ?? (args?.command ? truncate(args.command, 100) : undefined);
        if (desc) return `🔧 \`${desc}\``;
      }
      return "";
    }
    case "tool.execution_complete": {
      const { success, toolName, result } = event.data ?? {};
      if (!success && toolName) {
        const errMsg = result?.content ?? "";
        return errMsg ? `❌ **${toolName}**: ${truncate(errMsg, 200)}` : "";
      }
      return "";
    }
    // Legacy format
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
