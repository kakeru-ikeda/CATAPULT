import { describe, it, expect } from "vitest";

import { formatDiscordEvent, splitIntoChunks } from "../discord-embeds.js";
import type { CopilotEvent } from "../slack-blocks.js";

describe("formatDiscordEvent", () => {
  it("agent_step イベントを正しくフォーマットする", () => {
    const event: CopilotEvent = { type: "agent_step", content: "作業を開始します" };
    expect(formatDiscordEvent(event)).toBe("💭 作業を開始します");
  });

  it("tool_call イベントを正しくフォーマットする（太字マークダウン）", () => {
    const event: CopilotEvent = {
      type: "tool_call",
      tool: "create_file",
      input: { path: "src/index.ts" },
    };
    const result = formatDiscordEvent(event);
    expect(result).toContain("🔧");
    expect(result).toContain("**create_file**");
  });

  it("file_edit イベントを正しくフォーマットする", () => {
    const event: CopilotEvent = { type: "file_edit", path: "src/main.ts" };
    expect(formatDiscordEvent(event)).toBe("📝 src/main.ts");
  });

  it("error イベントを正しくフォーマットする", () => {
    const event: CopilotEvent = { type: "error", message: "エラーが発生しました" };
    expect(formatDiscordEvent(event)).toBe("❌ エラーが発生しました");
  });

  it("done イベントを正しくフォーマットする（PR URLあり）", () => {
    const event: CopilotEvent = {
      type: "done",
      summary: "バグを修正しました",
      prUrl: "https://github.com/owner/repo/pull/42",
    };
    const result = formatDiscordEvent(event);
    expect(result).toContain("✅");
    expect(result).toContain("**完了**");
    expect(result).toContain("[PR を開く](https://github.com/owner/repo/pull/42)");
  });
});

describe("splitIntoChunks", () => {
  it("短いテキストはそのまま返す", () => {
    const text = "短いテキスト";
    const chunks = splitIntoChunks(text, 1900);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it("長いテキストを適切なチャンクに分割する", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${"x".repeat(30)}`);
    const text = lines.join("\n");
    const chunks = splitIntoChunks(text, 1900);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1900);
    }
  });

  it("空文字列は空配列を返す", () => {
    const chunks = splitIntoChunks("", 1900);
    expect(chunks).toHaveLength(0);
  });
});
