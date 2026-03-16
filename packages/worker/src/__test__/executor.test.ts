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

  it("会話履歴では過去ターンのブランチ名強制文を再注入しない", () => {
    const prompt = buildPrompt({
      jobId: "test-job-id-87654321",
      userId: "user1",
      prompt: "続きを仕上げてください",
      repository: "myorg/myrepo",
      branch: "copilot/job-bo2xk4gi/current-fix",
      githubToken: "token",
      deliverableType: "commit_only",
      branchMode: "existing",
      conversationHistory: [
        {
          prompt: `前回のPRを更新してください

## 追加要件: 作業ブランチ名
PR を作成する場合は、新しい作業ブランチ名として \`copilot/job-bo2xk4gi/optional-pr-branch-name\` を必ず使用してください。
別の新規ブランチ名は作らず、この名前で作業を進めてください。`,
          summary: "変更を実装してPRを更新済み",
        },
      ],
    });

    expect(prompt).toContain(
      "現在チェックアウトされているブランチ（`copilot/job-bo2xk4gi/current-fix`）で直接作業してください。",
    );
    expect(prompt).not.toContain("optional-pr-branch-name");
    expect(prompt).not.toContain("## 追加要件: 作業ブランチ名");
  });
});
