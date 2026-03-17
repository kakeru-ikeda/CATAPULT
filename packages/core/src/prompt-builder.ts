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

/**
 * buildPromptWithPreferredBranchName で埋め込まれたブランチ名をプロンプト文字列から取り出す。
 * 対応するセクションが見つからない場合は undefined を返す。
 *
 * @remarks
 * このパターンは packages/bot/src/handlers/branch-preference.ts の
 * buildPromptWithPreferredBranchName が生成するテキストと対応している。
 * そちらのフォーマットを変更する際は、ここの正規表現も合わせて更新すること。
 */
export function extractPreferredBranchNameFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(
    /## 追加要件: 作業ブランチ名\nPR を作成する場合は、新しい作業ブランチ名として `([^`]+)` を必ず使用してください。/,
  );
  return match?.[1];
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

  // branchMode が明示されていれば優先。未指定時は旧来の挙動（new）
  const isExistingBranchContinuation = options.branchMode === "existing";

  const branchInstruction =
    !options.repository || deliverableType === "report" || deliverableType === "review"
      ? ""
      : isExistingBranchContinuation
        ? `
## 重要: ブランチの扱い
現在チェックアウトされているブランチ（\`${options.branch}\`）で直接作業してください。
新しいブランチを作成してはいけません。このブランチに変更をコミット・プッシュしてください。
`
        : options.preferredBranchName
          ? `
## 重要: ブランチ名
作業ブランチを作成する際は、必ず \`${options.preferredBranchName}\` という名前を使用してください。
別の名前でブランチを作成しないでください。
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
      ? `## 出力形式: PR 作成（ブランチへのコミット・プッシュのみ）\n作業ブランチを作成し、変更をコミット・プッシュしてください。\nプルリクエストの作成はシステムが自動的に行うため、\`gh pr create\` は実行しないでください。\n`
      : isExistingBranchContinuation
        ? `## 出力形式: 既存PRへの追加コミット\n現在のブランチ（\`${options.branch}\`）に変更をコミット・プッシュしてください。\nプルリクエストは新たに作成しないでください（既存のPRが自動更新されます）。\n`
        : DELIVERABLE_INSTRUCTIONS[deliverableType];

  const prTitleInstruction =
    deliverableType === "pr" && options.repository
      ? `\n- **1行目**には、このPRで行った変更を端的に表す日本語タイトルを記述してください（例: \`ログイン画面のバリデーションを修正\`）。この1行目がそのままPRのタイトルになります。Markdownの見出し記号（\`#\`）は使わず、プレーンテキストで書いてください。`
      : "";

  const finalAnswerInstruction = `## タスクの完了条件（超重要）
あなたは非インタラクティブなCLI環境（ワンショット実行）で動作しています。ツールを使用せずにテキストのみで「次に〜します」などの発言をすると、プロセスが即座に終了しタスクが失敗します。作業を継続する場合は、必ずツールの実行を行ってください。
すべての作業が完了したら、実施した作業の結果をそのままワークスペース直下の \`CATAPULT_SUMMARY.md\` に書き出してください。
- このファイルの内容がそのままユーザーに送信されます。ファイルの作成をもってタスク完了とみなします。${prTitleInstruction}
- **\`CATAPULT_SUMMARY.md\` の書き込みは必ず Python3 で行ってください。** \`echo\`, \`cat\`, ヒアドキュメント等のシェルコマンドで直接書き込むと、CLIのコマンド実行マーカー（\`___BEGIN___COMMAND_OUTPUT_MARKER___\` 等）がファイルに混入し、PRの説明文が破損します。\`markdown-with-python3\` スキルが利用可能な場合はそれに従い、スクリプトファイルを \`create_file\` で作成してから \`python3\` で実行してください。`;

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
