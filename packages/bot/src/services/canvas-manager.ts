import type { Platform } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import type { WebClient } from "@slack/web-api";

const prisma = new PrismaClient();

// Canvas 本文の最大文字数（Slack Canvas の実績ベース上限）
const CANVAS_MAX_CHARS = 15000;

// 前ジョブのサマリー（Canvas 上部に表示される履歴）
export interface PreviousJobSummary {
  task: string;
  repo: string;
  branch: string;
  completedAt: Date;
  resultSummary: string | null;
  prUrl: string | null;
}

// JobStreamRelay に渡す現在ジョブのコンテキスト
export interface JobCanvasContext {
  jobId: string;
  repo: string;
  branch: string;
  task: string;
  startedAt: Date;
}

// Canvas 描画に使う進捗状態
export interface CanvasProgressState {
  stepCount: number;
  lastTool: string | null;
  lastAssistantMessage: string | null;
  isDone: boolean;
  isError: boolean;
  isCancelled: boolean;
  finalSummary: string | null;
  prUrl: string | null;
  errorMessage: string | null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "...";
}

function formatJST(date: Date): string {
  return date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

/**
 * Canvas に表示するマークダウン全体を構築する。
 * 前ジョブの結果（最大3件）を上部に、現在ジョブを末尾に配置する。
 */
export function buildCanvasMarkdown(
  previousJobs: PreviousJobSummary[],
  current: JobCanvasContext,
  progress: CanvasProgressState,
): string {
  let md = "# 🤖 Copilot Catapult\n\n";

  // 前ジョブの結果（最大3件）
  const recentJobs = previousJobs.slice(-3);
  for (const job of recentJobs) {
    const title = truncate(job.task, 60);
    md += `## ✅ ${title}\n\n`;
    md += `**リポジトリ:** \`${job.repo}\` @ \`${job.branch}\`\n`;
    md += `**完了:** ${formatJST(job.completedAt)}\n\n`;
    if (job.resultSummary) {
      md += truncate(job.resultSummary, 500) + "\n\n";
    }
    if (job.prUrl) {
      md += `🔀 [PR を開く](${job.prUrl})\n\n`;
    }
    md += "---\n\n";
  }

  // 現在のジョブ
  const taskTitle = truncate(current.task, 60);

  if (progress.isDone) {
    md += `## ✅ ${taskTitle}\n\n`;
    md += `**リポジトリ:** \`${current.repo}\` @ \`${current.branch}\`\n`;
    md += `**完了:** ${formatJST(new Date())}\n\n`;
    if (progress.finalSummary) {
      md += progress.finalSummary + "\n\n";
    }
    if (progress.prUrl) {
      md += `🔀 [PR を開く](${progress.prUrl})\n\n`;
    }
  } else if (progress.isError) {
    md += `## ❌ ${taskTitle}\n\n`;
    md += `**リポジトリ:** \`${current.repo}\` @ \`${current.branch}\`\n\n`;
    md += `**エラー:** ${truncate(progress.errorMessage ?? "不明なエラー", 500)}\n\n`;
  } else if (progress.isCancelled) {
    md += `## 🛑 ${taskTitle}\n\n`;
    md += `**リポジトリ:** \`${current.repo}\` @ \`${current.branch}\`\n\n`;
    md += "キャンセルされました\n\n";
  } else {
    // 実行中
    md += `## 🔄 ${taskTitle}\n\n`;
    md += `**リポジトリ:** \`${current.repo}\` @ \`${current.branch}\`\n`;
    md += `**開始:** ${formatJST(current.startedAt)}\n\n`;
    md += `⚙️ 作業中... (ステップ ${progress.stepCount})\n`;
    if (progress.lastTool) {
      md += `🔧 \`${progress.lastTool}\`\n`;
    }
    if (progress.lastAssistantMessage) {
      md += `💬 ${progress.lastAssistantMessage}\n`;
    }
  }

  // 文字数上限
  if (md.length > CANVAS_MAX_CHARS) {
    md = md.slice(0, CANVAS_MAX_CHARS) + "\n\n...(省略)";
  }

  return md;
}

// ワークスペース URL のキャッシュ（Bot 再起動までの間有効）
let cachedWorkspaceUrl: string | null = null;

// 無料プランなど Canvas 非対応ワークスペースの場合に true にするフラグ
// SLACK_CANVAS_DISABLED=true で起動時から Canvas をバイパスできる
let canvasUnavailable = process.env.SLACK_CANVAS_DISABLED === "true";

/**
 * auth.test からワークスペース URL を取得し、Canvas の URL を組み立てる。
 * 追加スコープ不要（auth.test は常に利用可能）。
 */
export async function getCanvasUrl(canvasId: string, client: WebClient): Promise<string> {
  if (!cachedWorkspaceUrl) {
    try {
      const authInfo = await client.auth.test();
      cachedWorkspaceUrl = authInfo.url ?? null;
    } catch {
      // 取得失敗時はフォールバック URL を使用
    }
  }
  const base = cachedWorkspaceUrl ?? "https://slack.com/";
  return `${base}docs/${canvasId}`;
}

/**
 * スレッド対応の Canvas を取得または作成する。
 * 既存 Canvas がある場合はその ID を返す。
 * 無料プランなど Canvas 非対応ワークスペースの場合は null を返す（メッセージ方式にフォールバック）。
 */
export async function getOrCreateThreadCanvas(
  platform: Platform,
  channelId: string,
  threadId: string,
  client: WebClient,
): Promise<{ canvasId: string; isNew: boolean; url: string } | null> {
  // 非対応ワークスペースはスキップ
  if (canvasUnavailable) return null;

  const existing = await prisma.threadCanvas.findUnique({
    where: {
      platform_channelId_threadId: { platform, channelId, threadId },
    },
  });

  if (existing) {
    const url = await getCanvasUrl(existing.canvasId, client);
    return { canvasId: existing.canvasId, isNew: false, url };
  }

  // Slack Canvas を新規作成
  try {
    const result = await client.canvases.create({
      title: "Copilot Catapult",
      document_content: {
        type: "markdown",
        markdown: "# 🤖 Copilot Catapult\n\n作業ログを開始します...",
      },
    });

    const canvasId = result.canvas_id!;

    // Canvas をチャンネルメンバーが閲覧できるよう共有する
    // （作成直後はBot専有のプライベート状態のため必須）
    await client.canvases.access.set({
      canvas_id: canvasId,
      access_level: "read",
      channel_ids: [channelId],
    });

    await prisma.threadCanvas.create({
      data: { platform, channelId, threadId, canvasId },
    });

    const url = await getCanvasUrl(canvasId, client);
    return { canvasId, isNew: true, url };
  } catch (err) {
    // 無料プランや権限不足の場合はフォールバックを有効化して null を返す
    const isUnsupported =
      err instanceof Error &&
      (err.message.includes("free_teams_cannot_create_non_tabbed_canvases") ||
        err.message.includes("missing_scope") ||
        err.message.includes("not_allowed"));
    if (isUnsupported) {
      canvasUnavailable = true;
      console.info(
        "[CanvasManager] Canvas unavailable for this workspace, falling back to message mode.",
      );
      return null;
    }
    throw err;
  }
}

/**
 * Canvas 全体を新しいマークダウンで置き換える。
 * section_id を省略した replace オペレーションはキャンバス全体を置換する。
 */
export async function updateThreadCanvas(
  canvasId: string,
  markdown: string,
  client: WebClient,
): Promise<void> {
  await client.canvases.edit({
    canvas_id: canvasId,
    changes: [
      {
        operation: "replace",
        document_content: { type: "markdown", markdown },
      },
    ],
  });
}
