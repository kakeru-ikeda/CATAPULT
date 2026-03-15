import { DeliverableType, ExecuteOptions } from "./types.js";

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
  const branchInstruction = options.repository
    ? `
## 重要: ブランチ名の形式
作業ブランチを作成する際は、必ず以下の形式を使用してください:
  copilot/job-${jobShortId}/<機能名>
例: copilot/job-${jobShortId}/fix-login-bug
`
    : "";

  const previousContextSection = options.previousContext
    ? `## 前回の作業サマリー\n${options.previousContext}`
    : "";

  const deliverableType = options.deliverableType ?? "pr";

  const deliverableInstruction =
    deliverableType === "pr" && options.repository
      ? `## 出力形式: PR 作成\n変更をブランチにコミット・プッシュし、\`${options.repository}\` リポジトリにプルリクエストを作成してください。\n`
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
