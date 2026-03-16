const CONTROL_MARKER_NAMES = [
  "current_datetime",
  "system_notification",
  "reminder",
  "sql_tables",
] as const;

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * CATAPULT がプロンプトに挿入する制御用マーカーを除去する。
 * Slack/Discord のリンク記法などを壊さないよう、単純なタグ全削除ではなく
 * 既知タグと「タグだけの行」を対象にしている。
 */
export function stripCommandMarkers(text: string): string {
  let sanitized = text.replace(/\r\n/g, "\n");

  for (const markerName of CONTROL_MARKER_NAMES) {
    const blockPattern = new RegExp(`<${markerName}>[\\s\\S]*?<\\/${markerName}>`, "gi");
    const singleLinePattern = new RegExp(`^\\s*<\\/?${markerName}>\\s*$`, "gim");
    sanitized = sanitized.replace(blockPattern, "");
    sanitized = sanitized.replace(singleLinePattern, "");
  }

  sanitized = sanitized.replace(/^\s*<\/?[a-z_][a-z0-9_-]*>\s*$/gim, "");
  return collapseBlankLines(sanitized);
}

export function sanitizeSummary(summary: string): string {
  const sanitized = stripCommandMarkers(summary);
  return sanitized || "タスクが完了しました（報告内容の生成なし）";
}

export function sanitizePromptContext(text: string, fallback = "（サニタイズにより省略）"): string {
  const sanitized = stripCommandMarkers(text);
  return sanitized || fallback;
}
