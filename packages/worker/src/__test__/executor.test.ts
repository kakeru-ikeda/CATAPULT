import type { ExecuteOptions } from "@catapult/core";
import { describe, it, expect } from "vitest";

import { CopilotExecutor } from "../executor.js";

// buildPrompt は private だが型安全にアクセスするためのヘルパー
function callBuildPrompt(options: ExecuteOptions): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  return (new CopilotExecutor() as any).buildPrompt(options) as string;
}

describe("CopilotExecutor.buildPrompt", () => {
  const buildPrompt = callBuildPrompt;

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
    expect(prompt).toContain("`myorg/myrepo`");
    expect(prompt).toContain("プルリクエストを作成");
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
});
