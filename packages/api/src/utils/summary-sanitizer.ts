const CONTROL_MARKER_NAMES = [
  "current_datetime",
  "system_notification",
  "reminder",
  "sql_tables",
] as const;

export function sanitizeSummary(text: string): string {
  let sanitized = text.replace(/\r\n/g, "\n");

  for (const markerName of CONTROL_MARKER_NAMES) {
    const blockPattern = new RegExp(`<${markerName}>[\\s\\S]*?<\\/${markerName}>`, "gi");
    const singleLinePattern = new RegExp(`^\\s*<\\/?${markerName}>\\s*$`, "gim");
    sanitized = sanitized.replace(blockPattern, "");
    sanitized = sanitized.replace(singleLinePattern, "");
  }

  sanitized = sanitized.replace(/^\s*<\/?[a-z_][a-z0-9_-]*>\s*$/gim, "");
  sanitized = sanitized.replace(/\n{3,}/g, "\n\n").trim();

  return sanitized || "タスクが完了しました（報告内容の生成なし）";
}
