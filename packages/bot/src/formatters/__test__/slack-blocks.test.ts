import { describe, it, expect } from "vitest";

import { formatEvent } from "../slack-blocks.js";
import type { CopilotEvent } from "../slack-blocks.js";

describe("formatEvent (Slack)", () => {
  it("agent_step イベントを正しくフォーマットする", () => {
    const event: CopilotEvent = { type: "agent_step", content: "作業を開始します" };
    expect(formatEvent(event)).toBe("💭 作業を開始します");
  });

  it("tool_call イベントを正しくフォーマットする", () => {
    const event: CopilotEvent = {
      type: "tool_call",
      tool: "create_file",
      input: { path: "src/index.ts" },
    };
    const result = formatEvent(event);
    expect(result).toContain("🔧");
    expect(result).toContain("create_file");
  });

  it("shell イベントを正しくフォーマットする", () => {
    const event: CopilotEvent = {
      type: "shell",
      command: "npm test",
      stdout: "PASS",
    };
    const result = formatEvent(event);
    expect(result).toContain("📟");
    expect(result).toContain("npm test");
    expect(result).toContain("PASS");
  });

  it("file_edit イベントを正しくフォーマットする", () => {
    const event: CopilotEvent = { type: "file_edit", path: "src/main.ts" };
    expect(formatEvent(event)).toBe("📝 src/main.ts");
  });

  it("error イベントを正しくフォーマットする", () => {
    const event: CopilotEvent = { type: "error", message: "エラーが発生しました" };
    expect(formatEvent(event)).toBe("❌ エラーが発生しました");
  });

  it("done イベントを正しくフォーマットする（PR URLあり）", () => {
    const event: CopilotEvent = {
      type: "done",
      summary: "バグを修正しました",
      prUrl: "https://github.com/owner/repo/pull/42",
    };
    const result = formatEvent(event);
    expect(result).toContain("✅");
    expect(result).toContain("バグを修正しました");
    expect(result).toContain("https://github.com/owner/repo/pull/42");
  });

  it("done イベントを正しくフォーマットする（PR URLなし）", () => {
    const event: CopilotEvent = { type: "done", summary: "完了" };
    const result = formatEvent(event);
    expect(result).toContain("✅");
    expect(result).not.toContain("PR");
  });

  it("tool_call の input が長い場合は truncate される", () => {
    const event: CopilotEvent = {
      type: "tool_call",
      tool: "some_tool",
      input: { data: "x".repeat(200) },
    };
    const result = formatEvent(event);
    expect(result.length).toBeLessThan(300);
    expect(result).toContain("...");
  });
});
