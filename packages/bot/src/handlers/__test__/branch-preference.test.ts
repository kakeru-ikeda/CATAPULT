import { describe, expect, it } from "vitest";

import {
  buildPromptWithPreferredBranchName,
  normalizePreferredBranchName,
  validatePreferredBranchName,
} from "../branch-preference.js";

describe("branch-preference", () => {
  it("空文字のブランチ名は未設定として扱う", () => {
    expect(normalizePreferredBranchName("   ")).toBeUndefined();
  });

  it("不正なブランチ名を弾く", () => {
    expect(validatePreferredBranchName("feature bad")).toBe(
      "ブランチ名に使えない文字が含まれています。",
    );
    expect(validatePreferredBranchName("feature..bad")).toBe(
      "ブランチ名に使えない並びが含まれています。",
    );
  });

  it("設定されたブランチ名をタスクに追記する", () => {
    expect(buildPromptWithPreferredBranchName("バグ修正して", "feature/fix-login")).toContain(
      "`feature/fix-login`",
    );
  });

  it("ブランチ名が未設定なら元のタスクをそのまま返す", () => {
    expect(buildPromptWithPreferredBranchName("調査して", undefined)).toBe("調査して");
  });
});
