import { describe, it, expect } from "vitest";

import type { CopilotEvent } from "../slack-blocks.js";

describe("CopilotEvent", () => {
  it("必須フィールドを持つオブジェクトを構築できる", () => {
    const event: CopilotEvent = { type: "tool.execution_start" };
    expect(event.type).toBe("tool.execution_start");
  });

  it("new Copilot CLI v1.x のフィールドを保持できる", () => {
    const event: CopilotEvent = {
      type: "assistant.message",
      data: { content: "テスト" },
    };
    expect(event.data?.content).toBe("テスト");
  });

  it("done イベントのフィールドを保持できる", () => {
    const event: CopilotEvent = {
      type: "done",
      summary: "完了しました",
      prUrl: "https://github.com/owner/repo/pull/42",
    };
    expect(event.summary).toBe("完了しました");
    expect(event.prUrl).toContain("/pull/42");
  });
});
