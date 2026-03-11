import { describe, it, expect } from "vitest";

import { splitIntoChunks } from "../discord-embeds.js";

describe("splitIntoChunks", () => {
  it("短いテキストはそのまま返す", () => {
    const text = "短いテキスト";
    const chunks = splitIntoChunks(text, 1900);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it("長いテキストを適切なチャンクに分割する", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${"x".repeat(30)}`);
    const text = lines.join("\n");
    const chunks = splitIntoChunks(text, 1900);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1900);
    }
  });

  it("空文字列は空配列を返す", () => {
    const chunks = splitIntoChunks("", 1900);
    expect(chunks).toHaveLength(0);
  });
});
