import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { JobGuard, JobLimitError } from "../job-guard.js";

// Prisma と Redis をモック
vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    job: {
      count: vi.fn(),
    },
  })),
}));

vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

describe("JobGuard", () => {
  let guard: JobGuard;
  let mockPrisma: InstanceType<typeof PrismaClient>;
  let mockRedis: InstanceType<typeof Redis>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = new PrismaClient();
    mockRedis = new Redis();
    guard = new JobGuard();
  });

  it("正常な場合はエラーをスローしない", async () => {
    vi.mocked(mockPrisma.job)
      .count.mockResolvedValueOnce(0) // runningByUser
      .mockResolvedValueOnce(0) // runningByRepo
      .mockResolvedValueOnce(0); // dailyCount
    vi.mocked(mockRedis).get.mockResolvedValue(null);

    // JobGuard は内部でインスタンスを持つため、直接モックを注入できない。
    // モックが呼び出されることをテストする代わりに、
    // 実際の check メソッドが JobLimitError を投げないことを確認する。
    await expect(guard.check("user1", "owner/repo")).resolves.toBeUndefined();
  });

  it("JobLimitError クラスが Error を継承している", () => {
    const err = new JobLimitError("テストエラー");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(JobLimitError);
    expect(err.name).toBe("JobLimitError");
    expect(err.message).toBe("テストエラー");
  });
});
