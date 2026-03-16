import { buildPrompt } from "@catapult/core";
import { describe, it, expect } from "vitest";

describe("buildPrompt", () => {
  it("PR モードでリポジトリが指定されている場合、リポジトリ名を含む PR 指示が生成される", () => {
    const prompt = buildPrompt({
      jobId: "test-job-id-12345678",
      userId: "user1",
      prompt: "バグを修正してください",
      repository: "myorg/myrepo",
      branch: "main",
      githubToken: "token",
      deliverableType: "pr",
    });
    expect(prompt).toContain("PR 作成");
    expect(prompt).toContain("gh pr create");
  });

  it("PR モードでリポジトリが空の場合、デフォルトの PR 指示が使われる", () => {
    const prompt = buildPrompt({
      jobId: "test-job-id-12345678",
      userId: "user1",
      prompt: "バグを修正してください",
      repository: "",
      branch: "",
      githubToken: "token",
      deliverableType: "pr",
    });
    expect(prompt).not.toContain("myorg/myrepo");
  });

  it("PR モード以外（report）では report 指示が生成される", () => {
    const prompt = buildPrompt({
      jobId: "test-job-id-12345678",
      userId: "user1",
      prompt: "調査してください",
      repository: "myorg/myrepo",
      branch: "main",
      githubToken: "token",
      deliverableType: "report",
    });
    expect(prompt).toContain("調査・報告");
    expect(prompt).not.toContain("プルリクエストを作成");
  });

  it("ユーザーのプロンプトが含まれる", () => {
    const prompt = buildPrompt({
      jobId: "test-job-id-12345678",
      userId: "user1",
      prompt: "特定のタスクを実行してください",
      repository: "myorg/myrepo",
      branch: "main",
      githubToken: "token",
      deliverableType: "pr",
    });
    expect(prompt).toContain("特定のタスクを実行してください");
  });

  it("会話履歴内のコマンドマーカーをサニタイズし、非表示指示を追加する", () => {
    const prompt = buildPrompt({
      jobId: "test-job-id-12345678",
      userId: "user1",
      prompt: "前回の続き",
      repository: "myorg/myrepo",
      branch: "main",
      githubToken: "token",
      deliverableType: "pr",
      conversationHistory: [
        {
          prompt: "前回の依頼",
          summary:
            "完了しました\n<current_datetime>2026-03-16T10:25:44.321Z</current_datetime>\n<reminder>hidden</reminder>",
        },
      ],
    });

    expect(prompt).toContain("完了しました");
    expect(prompt).not.toContain("2026-03-16T10:25:44.321Z");
    expect(prompt).not.toContain("hidden");
    expect(prompt).toContain("コマンドマーカー・制御タグを含めてはいけません");
  });
});
