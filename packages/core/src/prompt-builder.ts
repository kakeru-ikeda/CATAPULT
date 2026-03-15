import { ConversationTurn, DeliverableType, ExecuteOptions } from "./types.js";

/** ConversationTurn[] をプロンプト埋め込み用のテキストに変換する */
function formatConversationHistory(history: ConversationTurn[]): string {
  return history
    .map((turn, i) => {
      const summary = turn.prUrl ? `${turn.summary}\n\nPR: ${turn.prUrl}` : turn.summary;
      return `### ターン ${i + 1}\n**ユーザー:** ${turn.prompt}\n\n**結果:** ${summary}`;
    })
    .join("\n\n---\n\n");
}

const DELIVERABLE_INSTRUCTIONS: Record<DeliverableType, string> = {
  pr: "",
  report: `## 出力形式: 調査・報告
コードの変更・コミット・プッシュ・PR作成は行わないでください。
以下のタスクについて調査し、結果をまとめて出力してください。

`,
  commit_only: `## 出力形式: コミットのみ
変更をブランチにコミット・プッシュしてください。
プルリクエストは作成しないでください。

`,
  review: `## 出力形式: コードレビュー
コードを変更・コミット・プッシュしないでください。
既存のコードをレビューし、改善点・問題点・良い点を整理して出力してください。

`,
};

export function buildPrompt(options: ExecuteOptions): string {
  const jobShortId = options.jobId.slice(-8);
  const deliverableType = options.deliverableType ?? "pr";

  // commit_only かつ既存の Copilot 作業ブランチを継続する場合は新ブランチを作らせない
  const isExistingBranchContinuation =
    deliverableType === "commit_only" && options.branch.startsWith("copilot/");

  const branchInstruction = !options.repository
    ? ""
    : isExistingBranchContinuation
      ? `
## 重要: ブランチの扱い
現在チェックアウトされているブランチ（\`${options.branch}\`）で直接作業してください。
新しいブランチを作成してはいけません。このブランチに変更をコミット・プッシュしてください。
`
      : `
## 重要: ブランチ名の形式
作業ブランチを作成する際は、必ず以下の形式を使用してください:
  copilot/job-${jobShortId}/<機能名>
例: copilot/job-${jobShortId}/fix-login-bug
`;

  const previousContextSection =
    options.conversationHistory && options.conversationHistory.length > 0
      ? `## このスレッドのこれまでの会話履歴\n以下は同じスレッドで行われた過去のやり取りです。前後の文脈を踏まえて今回のタスクに答えてください。\n\n${formatConversationHistory(options.conversationHistory)}`
      : "";

  const deliverableInstruction =
    deliverableType === "pr" && options.repository
      ? `## 出力形式: PR 作成\n変更をブランチにコミット・プッシュし、\`${options.repository}\` リポジトリにプルリクエストを作成してください。\n`
      : isExistingBranchContinuation
        ? `## 出力形式: 既存PRへの追加コミット\n現在のブランチ（\`${options.branch}\`）に変更をコミット・プッシュしてください。\nプルリクエストは新たに作成しないでください（既存のPRが自動更新されます）。\n`
        : DELIVERABLE_INSTRUCTIONS[deliverableType];

  const finalAnswerInstruction = `## 環境の制約とタスクの完了条件（超重要）
あなたは非インタラクティブなCLI環境（ワンショット実行）で動作しています。ツールを使用せずにテキストのみで「次に〜します」などの発言をすると、プロセスが即座に終了しタスクが失敗します。作業を継続する場合は、必ずツールの実行を行ってください。
すべての作業が完了したら、ユーザーに報告すべき最終的なサマリー（調査結果、レビュー内容、PR作成結果など）を、ワークスペース直下に \`CATAPULT_SUMMARY.md\` というファイル名で書き出してください。
システムはこのファイルの内容を読み取ってユーザーに送信します。ファイルの作成をもってタスク完了とみなします。`;

  return [
    deliverableInstruction,
    branchInstruction,
    options.instructions ?? "",
    previousContextSection,
    options.prompt,
    finalAnswerInstruction,
  ]
    .filter(Boolean)
    .join("\n\n");
}
