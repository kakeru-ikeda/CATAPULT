export interface CreatePullRequestParams {
  githubToken: string;
  repository: string; // "owner/repo"
  head: string; // 作業ブランチ
  base: string; // ベースブランチ
  title: string;
  body: string;
}

interface GitHubPullRequestResponse {
  html_url: string;
  number: number;
}

interface GitHubErrorResponse {
  message: string;
  errors?: Array<{ message?: string }>;
}

/**
 * CATAPULT_SUMMARY.md の1行目をPRタイトルとして抽出する。
 * Markdownの見出し（# ）を除去し、空白行はスキップする。
 */
export function extractPrTitle(summary: string): string {
  for (const line of summary.split("\n")) {
    const trimmed = line.replace(/^#+\s*/, "").trim();
    if (trimmed) return trimmed.slice(0, 120);
  }
  return "Copilot による変更";
}

/**
 * GitHub REST API を使って PR を作成する。
 * 同名PRが既に存在する場合（422）はそのPRのURLを探して返す。
 */
export async function createPullRequest(params: CreatePullRequestParams): Promise<string> {
  const { githubToken, repository, head, base, title, body } = params;

  const response = await fetch(`https://api.github.com/repos/${repository}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body, head, base }),
  });

  if (response.ok) {
    const data = (await response.json()) as GitHubPullRequestResponse;
    return data.html_url;
  }

  // 既存PR（同ブランチのオープンPRが存在する場合）は検索して返す
  if (response.status === 422) {
    const errData = (await response.json()) as GitHubErrorResponse;
    const alreadyExists = errData.errors?.some((e) =>
      e.message?.includes("A pull request already exists"),
    );
    if (alreadyExists) {
      const existing = await findExistingPullRequest({ githubToken, repository, head });
      if (existing) return existing;
    }
    throw new Error(`GitHub PR create failed (422): ${errData.message}`);
  }

  const text = await response.text();
  throw new Error(`GitHub PR create failed (${response.status}): ${text.slice(0, 300)}`);
}

async function findExistingPullRequest(params: {
  githubToken: string;
  repository: string;
  head: string;
}): Promise<string | undefined> {
  const { githubToken, repository, head } = params;
  const [owner] = repository.split("/");
  const response = await fetch(
    `https://api.github.com/repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`,
    {
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    },
  );
  if (!response.ok) return undefined;
  const prs = (await response.json()) as GitHubPullRequestResponse[];
  return prs[0]?.html_url;
}
