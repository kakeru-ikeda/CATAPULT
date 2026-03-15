import { describe, it, expect } from "vitest";

import type { CopilotEvent } from "../executor.js";
import { extractFinalAssistantMessage, extractPrUrl, parseCopilotEvent } from "../output-parser.js";

describe("parseCopilotEvent", () => {
  it("有効な JSON を正しくパースする", () => {
    const line = '{"type":"agent_step","content":"作業を開始します"}';
    const event = parseCopilotEvent(line);
    expect(event).toEqual({ type: "agent_step", content: "作業を開始します" });
  });

  it("無効な JSON は null を返す", () => {
    expect(parseCopilotEvent("invalid json")).toBeNull();
  });

  it("type フィールドがない場合は null を返す", () => {
    expect(parseCopilotEvent('{"content":"hello"}')).toBeNull();
  });

  it("空文字列は null を返す", () => {
    expect(parseCopilotEvent("")).toBeNull();
  });

  it("tool_call イベントをパースする", () => {
    const line = '{"type":"tool_call","tool":"create_file","input":{"path":"test.ts"}}';
    const event = parseCopilotEvent(line);
    expect(event?.type).toBe("tool_call");
    expect(event?.tool).toBe("create_file");
  });

  it("done イベントをパースする", () => {
    const line = '{"type":"done","summary":"完了","prUrl":"https://github.com/owner/repo/pull/1"}';
    const event = parseCopilotEvent(line);
    expect(event?.type).toBe("done");
    expect(event?.prUrl).toBe("https://github.com/owner/repo/pull/1");
  });
});

describe("extractPrUrl", () => {
  it("done イベントから PR URL を抽出する", () => {
    const events: CopilotEvent[] = [
      { type: "done", prUrl: "https://github.com/owner/repo/pull/42" },
    ];
    expect(extractPrUrl(events)).toBe("https://github.com/owner/repo/pull/42");
  });

  it("shell イベントの stdout から PR URL を抽出する", () => {
    const events: CopilotEvent[] = [
      {
        type: "shell",
        command: "gh pr create",
        stdout: "https://github.com/owner/repo/pull/10",
      },
    ];
    expect(extractPrUrl(events)).toBe("https://github.com/owner/repo/pull/10");
  });

  it("PR URL がない場合は undefined を返す", () => {
    const events: CopilotEvent[] = [{ type: "agent_step", content: "作業中" }];
    expect(extractPrUrl(events)).toBeUndefined();
  });

  it("空配列は undefined を返す", () => {
    expect(extractPrUrl([])).toBeUndefined();
  });
});

describe("extractFinalAssistantMessage", () => {
  it("最後の非空 assistant.message を返す", () => {
    const events: CopilotEvent[] = [
      { type: "assistant.message", data: { content: "途中経過" } },
      { type: "assistant.message", data: { content: "   " } },
      { type: "done", summary: "完了しました" },
      { type: "assistant.message", data: { content: "最終サマリー" } },
    ];

    expect(extractFinalAssistantMessage(events)).toBe("最終サマリー");
  });

  it("assistant.message が無い場合は undefined を返す", () => {
    const events: CopilotEvent[] = [{ type: "done", summary: "完了しました" }];

    expect(extractFinalAssistantMessage(events)).toBeUndefined();
  });
});
