export interface CopilotEvent {
  type: "agent_step" | "tool_call" | "shell" | "file_edit" | "thinking" | "error" | "done";
  content?: string;
  tool?: string;
  input?: unknown;
  command?: string;
  stdout?: string;
  stderr?: string;
  path?: string;
  message?: string;
  summary?: string;
  prUrl?: string;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export function formatEvent(event: CopilotEvent): string {
  switch (event.type) {
    case "agent_step":
      return `💭 ${event.content ?? ""}`;
    case "tool_call":
      return `🔧 *${event.tool ?? "unknown"}*: \`${truncate(JSON.stringify(event.input), 100)}\``;
    case "shell": {
      const stdout = truncate(event.stdout ?? "", 200);
      return `📟 \`${event.command ?? ""}\`${stdout ? `\n\`\`\`\n${stdout}\n\`\`\`` : ""}`;
    }
    case "file_edit":
      return `📝 ${event.path ?? ""}`;
    case "error":
      return `❌ ${event.message ?? "Unknown error"}`;
    case "done":
      return `✅ *完了*: ${event.summary ?? ""}${event.prUrl ? `\n<${event.prUrl}|PR を開く>` : ""}`;
    default:
      return "";
  }
}
