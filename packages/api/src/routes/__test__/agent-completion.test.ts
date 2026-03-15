import { describe, expect, it } from "vitest";

import { extractCompletionFromLogs } from "../agent-completion.js";

describe("extractCompletionFromLogs", () => {
  it("送信用メッセージ セクションを summary に使う", () => {
    const result = extractCompletionFromLogs([
      {
        eventType: "assistant.message",
        content: JSON.stringify({
          data: {
            content:
              "内部向けメモ\n\n## 送信用メッセージ\n検索機能の不具合を修正し、入力バリデーションも追加しました。\nnpm run test で確認済みです。",
          },
        }),
      },
    ]);

    expect(result).toEqual({
      prUrl: undefined,
      summary:
        "検索機能の不具合を修正し、入力バリデーションも追加しました。\nnpm run test で確認済みです。",
    });
  });

  it("最後の assistant.message を summary に使う", () => {
    const result = extractCompletionFromLogs([
      {
        eventType: "assistant.message",
        content: JSON.stringify({ data: { content: "長い途中経過メッセージ" } }),
      },
      {
        eventType: "assistant.message",
        content: JSON.stringify({ data: { content: "最終出力" } }),
      },
    ]);

    expect(result).toEqual({ prUrl: undefined, summary: "最終出力" });
  });

  it("assistant.message 内の PR URL を拾いつつ空メッセージは無視する", () => {
    const result = extractCompletionFromLogs([
      {
        eventType: "assistant.message",
        content: JSON.stringify({ data: { content: "   " } }),
      },
      {
        eventType: "assistant.message",
        content: JSON.stringify({
          data: {
            content: "PR を作成しました https://github.com/owner/repo/pull/42",
          },
        }),
      },
    ]);

    expect(result).toEqual({
      prUrl: "https://github.com/owner/repo/pull/42",
      summary: "PR を作成しました https://github.com/owner/repo/pull/42",
    });
  });

  it("done イベント由来の prUrl を優先し、要約が無ければデフォルトを返す", () => {
    const result = extractCompletionFromLogs([
      {
        eventType: "done",
        content: JSON.stringify({ prUrl: "https://github.com/owner/repo/pull/99" }),
      },
      {
        eventType: "assistant.message",
        content: "{invalid json",
      },
    ]);

    expect(result).toEqual({
      prUrl: "https://github.com/owner/repo/pull/99",
      summary: "タスクが完了しました",
    });
  });

  it("送信用メッセージ が無ければ最後の assistant.message をそのまま使う", () => {
    const result = extractCompletionFromLogs([
      {
        eventType: "assistant.message",
        content: JSON.stringify({ data: { content: "途中経過" } }),
      },
      {
        eventType: "assistant.message",
        content: JSON.stringify({ data: { content: "最終出力" } }),
      },
    ]);

    expect(result).toEqual({ prUrl: undefined, summary: "最終出力" });
  });
});
