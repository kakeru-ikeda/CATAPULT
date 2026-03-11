export function splitIntoChunks(text: string, maxLength = 1900): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
