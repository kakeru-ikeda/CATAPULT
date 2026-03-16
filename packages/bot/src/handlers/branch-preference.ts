export function normalizePreferredBranchName(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function validatePreferredBranchName(value?: string | null): string | undefined {
  const branchName = normalizePreferredBranchName(value);

  if (!branchName) {
    return undefined;
  }

  if (branchName === "@" || branchName === "HEAD") {
    return "そのブランチ名は使用できません。";
  }

  if (
    branchName.startsWith("/") ||
    branchName.endsWith("/") ||
    branchName.startsWith(".") ||
    branchName.endsWith(".")
  ) {
    return 'ブランチ名の先頭/末尾に "/" や "." は使えません。';
  }

  if (branchName.includes("..") || branchName.includes("//") || branchName.includes("@{")) {
    return "ブランチ名に使えない並びが含まれています。";
  }

  if (branchName.endsWith(".lock")) {
    return "`.lock` で終わるブランチ名は使えません。";
  }

  const hasInvalidAsciiControlCharacter = [...branchName].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });

  if (hasInvalidAsciiControlCharacter || /[ ~^:?*[\\]/.test(branchName)) {
    return "ブランチ名に使えない文字が含まれています。";
  }

  const parts = branchName.split("/");
  if (parts.some((part) => part.length === 0 || part.startsWith(".") || part.endsWith("."))) {
    return "ブランチ名の各セグメントは空にできず、`.` で始めたり終えたりできません。";
  }

  return undefined;
}

export function buildPromptWithPreferredBranchName(
  task: string,
  preferredBranchName?: string,
): string {
  const normalizedBranchName = normalizePreferredBranchName(preferredBranchName);

  if (!normalizedBranchName) {
    return task;
  }

  const trimmedTask = task.trimEnd();

  return `${trimmedTask}

## 追加要件: 作業ブランチ名
PR を作成する場合は、新しい作業ブランチ名として \`${normalizedBranchName}\` を必ず使用してください。
別の新規ブランチ名は作らず、この名前で作業を進めてください。`;
}
