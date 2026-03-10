import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { encrypt, decrypt } from "../token-vault.js";

const TEST_KEY = "0".repeat(64); // 32 bytes = 64 hex chars

describe("token-vault", () => {
  beforeEach(() => {
    process.env["TOKEN_ENCRYPTION_KEY"] = TEST_KEY;
  });

  afterEach(() => {
    delete process.env["TOKEN_ENCRYPTION_KEY"];
  });

  it("暗号化・復号化が正しく動作する", () => {
    const original = "ghu_test_token_12345";
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(decrypt(encrypted)).toBe(original);
  });

  it("同じ平文でも毎回異なる暗号文になる（IV がランダム）", () => {
    const original = "test";
    expect(encrypt(original)).not.toBe(encrypt(original));
  });

  it("暗号文は iv:authTag:encrypted の形式になる", () => {
    const encrypted = encrypt("hello");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);
  });

  it("不正な暗号文は例外をスローする", () => {
    expect(() => decrypt("invalid")).toThrow("Invalid ciphertext format");
  });

  it("TOKEN_ENCRYPTION_KEY が未設定の場合はエラーをスローする", () => {
    delete process.env["TOKEN_ENCRYPTION_KEY"];
    expect(() => encrypt("test")).toThrow("TOKEN_ENCRYPTION_KEY environment variable is not set");
  });

  it("TOKEN_ENCRYPTION_KEY が不正な長さの場合はエラーをスローする", () => {
    process.env["TOKEN_ENCRYPTION_KEY"] = "tooshort";
    expect(() => encrypt("test")).toThrow(
      "TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)",
    );
  });
});
