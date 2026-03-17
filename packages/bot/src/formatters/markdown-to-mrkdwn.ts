/**
 * Markdown テキストを Slack の mrkdwn 形式に変換する。
 *
 * Slack mrkdwn は標準 Markdown のサブセットであり、以下の差異がある:
 *  - 見出し (#, ##, ...) は非サポート → *bold* に変換
 *  - 太字は **text** ではなく *text*
 *  - 斜体は *text* ではなく _text_
 *  - 打ち消しは ~~text~~ ではなく ~text~
 *  - リンクは [text](url) ではなく <url|text>
 *  - 水平線は非サポート → 削除
 */
export function markdownToMrkdwn(text: string): string {
  // --- コードブロック・インラインコードを退避（変換対象外）---
  const codeBlocks: string[] = [];
  let result = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `\uE000CB${codeBlocks.length - 1}\uE000`;
  });

  const inlineCodes: string[] = [];
  result = result.replace(/`[^`\n]+`/g, (match) => {
    inlineCodes.push(match);
    return `\uE000IC${inlineCodes.length - 1}\uE000`;
  });

  // --- 見出し: # text → *text* (太字と同じプレースホルダーで保護) ---
  const bolds: string[] = [];
  result = result.replace(/^#{1,6} +(.+)$/gm, (_: string, heading: string) => {
    bolds.push(heading.trim());
    return `\uE000B${bolds.length - 1}\uE000`;
  });

  // --- 水平線: --- / *** / ___ → 空行 ---
  result = result.replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, "");

  // --- 太字を退避（後で斜体の * と衝突しないよう保護）---
  result = result.replace(/\*\*(.+?)\*\*/gs, (_: string, inner: string) => {
    bolds.push(inner);
    return `\uE000B${bolds.length - 1}\uE000`;
  });
  result = result.replace(/__(.+?)__/gs, (_: string, inner: string) => {
    bolds.push(inner);
    return `\uE000B${bolds.length - 1}\uE000`;
  });

  // --- 斜体: *text* → _text_（太字退避済みなので単独 * は斜体のみ）---
  result = result.replace(/\*(.+?)\*/gs, "_$1_");

  // --- 太字を復元 → Slack の *bold* ---
  result = result.replace(/\uE000B(\d+)\uE000/g, (_: string, i: string) => `*${bolds[Number(i)]}*`);

  // --- 打ち消し: ~~text~~ → ~text~ ---
  result = result.replace(/~~(.+?)~~/gs, "~$1~");

  // --- Markdown リンク: [text](url) → <url|text> ---
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<$2|$1>");

  // --- コードブロック・インラインコードを復元 ---
  result = result.replace(/\uE000CB(\d+)\uE000/g, (_: string, i: string) => codeBlocks[Number(i)] ?? "");
  result = result.replace(/\uE000IC(\d+)\uE000/g, (_: string, i: string) => inlineCodes[Number(i)] ?? "");

  return result;
}
