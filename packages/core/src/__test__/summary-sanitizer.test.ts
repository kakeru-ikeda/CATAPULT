import { describe, expect, it } from "vitest";

import {
  sanitizePromptContext,
  sanitizeSummary,
  stripCommandMarkers,
} from "../summary-sanitizer.js";

describe("stripCommandMarkers", () => {
  it("既知の制御タグブロックを除去する", () => {
    const input = [
      "変更内容",
      "<current_datetime>2026-03-16T10:25:44.321Z</current_datetime>",
      "<reminder>",
      "消したい制御文",
      "</reminder>",
      "完了",
    ].join("\n");

    expect(stripCommandMarkers(input)).toBe("変更内容\n\n完了");
  });
});

describe("sanitizeSummary", () => {
  it("マーカーだけの場合は既定の完了文にフォールバックする", () => {
    expect(sanitizeSummary("<reminder>hidden</reminder>")).toBe(
      "タスクが完了しました（報告内容の生成なし）",
    );
  });
});

describe("sanitizePromptContext", () => {
  it("空になった場合はプレースホルダーを返す", () => {
    expect(sanitizePromptContext("<current_datetime>now</current_datetime>")).toBe(
      "（サニタイズにより省略）",
    );
  });
});
