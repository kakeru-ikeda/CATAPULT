import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted で vi.mock() ファクトリ内から参照できるモック関数を定義
const {
  mockJobFindUnique,
  mockJobLogFindMany,
  mockSubscriberOn,
  mockSubscriberSubscribe,
  mockRedisDuplicate,
} = vi.hoisted(() => ({
  mockJobFindUnique: vi.fn().mockResolvedValue(null),
  mockJobLogFindMany: vi.fn().mockResolvedValue([]),
  mockSubscriberOn: vi.fn(),
  mockSubscriberSubscribe: vi.fn().mockResolvedValue(null),
  mockRedisDuplicate: vi.fn(),
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    job: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: mockJobFindUnique,
      create: vi.fn().mockResolvedValue({ id: "test-job-id", status: "PENDING" }),
      update: vi.fn().mockResolvedValue({ id: "test-job-id" }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(null),
    },
    jobLog: {
      findMany: mockJobLogFindMany,
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "test-user-id",
        githubUsername: "testuser",
        githubAvatarUrl: null,
        role: "USER",
      }),
      upsert: vi.fn(),
    },
    accountLink: {
      upsert: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    mcpTool: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "tool-id" }),
      update: vi.fn().mockResolvedValue({ id: "tool-id" }),
      delete: vi.fn().mockResolvedValue({ id: "tool-id" }),
    },
    instruction: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "instruction-id" }),
      update: vi.fn().mockResolvedValue({ id: "instruction-id" }),
      delete: vi.fn().mockResolvedValue({ id: "instruction-id" }),
    },
  })),
}));

vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(null),
    unsubscribe: vi.fn().mockResolvedValue(null),
    quit: vi.fn().mockResolvedValue(null),
    duplicate: mockRedisDuplicate,
    on: vi.fn(),
  })),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({ id: "bull-job-id" }),
  })),
}));

vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    chat: { postMessage: vi.fn().mockResolvedValue({ ok: true }) },
  })),
}));

const TEST_JWT_SECRET = "test-jwt-secret-stream";

function makeToken(role: "USER" | "ADMIN" = "USER", userId = "test-user-id") {
  return jwt.sign({ id: userId, role, githubUsername: "testuser" }, TEST_JWT_SECRET, {
    expiresIn: "1h",
  });
}

const completedJob = {
  id: "completed-job-id",
  userId: "test-user-id",
  repository: "owner/repo",
  branch: "main",
  prompt: "test",
  status: "COMPLETED",
  platform: "API",
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: new Date(),
};

const runningJob = {
  id: "running-job-id",
  userId: "test-user-id",
  repository: "owner/repo",
  branch: "main",
  prompt: "test",
  status: "RUNNING",
  platform: "API",
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
};

describe("GET /api/jobs/:id/stream (SSE統合テスト)", () => {
  beforeEach(() => {
    process.env["JWT_SECRET"] = TEST_JWT_SECRET;
    process.env["REDIS_URL"] = "redis://localhost:6379";
    process.env["TOKEN_ENCRYPTION_KEY"] = "0".repeat(64);

    mockJobFindUnique.mockReset();
    mockJobFindUnique.mockResolvedValue(null);

    mockJobLogFindMany.mockReset();
    mockJobLogFindMany.mockResolvedValue([]);

    mockSubscriberSubscribe.mockReset();
    mockSubscriberSubscribe.mockResolvedValue(null);

    mockSubscriberOn.mockReset();

    mockRedisDuplicate.mockReset();
    mockRedisDuplicate.mockReturnValue({
      subscribe: mockSubscriberSubscribe,
      on: mockSubscriberOn,
      unsubscribe: vi.fn().mockResolvedValue(null),
      quit: vi.fn().mockResolvedValue(null),
    });
  });

  it("未認証では 401 が返る", async () => {
    const { app } = await import("../../index.js");
    const response = await request(app).get("/api/jobs/some-id/stream");
    expect(response.status).toBe(401);
  });

  it("存在しないジョブは 404 が返る", async () => {
    const { app } = await import("../../index.js");
    const token = makeToken();
    const response = await request(app)
      .get("/api/jobs/nonexistent-id/stream")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(404);
  });

  it("別ユーザーのジョブは 403 が返る", async () => {
    mockJobFindUnique.mockResolvedValueOnce({
      id: "other-job-id",
      userId: "other-user-id",
      status: "RUNNING",
    });
    const { app } = await import("../../index.js");
    const token = makeToken(); // test-user-id でログイン
    const response = await request(app)
      .get("/api/jobs/other-job-id/stream")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(403);
  });

  it("完了済みジョブのSSEは既存ログをSSEフォーマットで返しストリームを終了する", async () => {
    const existingLogs = [
      {
        id: "log-1",
        jobId: "completed-job-id",
        type: "agent_step",
        content: "コードを分析中...",
        timestamp: new Date(),
      },
      {
        id: "log-2",
        jobId: "completed-job-id",
        type: "done",
        content: "PR作成完了",
        timestamp: new Date(),
      },
    ];
    mockJobFindUnique.mockResolvedValueOnce(completedJob);
    mockJobLogFindMany.mockResolvedValueOnce(existingLogs);

    const { app } = await import("../../index.js");
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const response = await fetch(`http://localhost:${port}/api/jobs/completed-job-id/stream`, {
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      // 完了済みジョブはストリームが終了するため response.text() が解決される
      const body = await response.text();
      expect(body).toContain("agent_step");
      expect(body).toContain("コードを分析中...");
      expect(body).toContain("done");
      expect(body).toContain("PR作成完了");
    } finally {
      (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("実行中ジョブのSSEはSSEヘッダーを返しRedis購読を開始する", async () => {
    mockJobFindUnique.mockResolvedValueOnce(runningJob);

    const { app } = await import("../../index.js");
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    const controller = new AbortController();

    try {
      // fetch は response headers 受信時点で resolve する
      const response = await fetch(`http://localhost:${port}/api/jobs/running-job-id/stream`, {
        headers: { authorization: `Bearer ${makeToken()}` },
        signal: controller.signal,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(response.headers.get("cache-control")).toBe("no-cache");

      // Redis 購読が実際に開始されるまで待機
      await vi.waitFor(
        () => {
          expect(mockSubscriberSubscribe).toHaveBeenCalledWith("job:running-job-id");
        },
        { timeout: 2000 },
      );

      await response.body?.cancel();
    } finally {
      controller.abort();
      (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("管理者は別ユーザーの完了済みジョブにもアクセスできる", async () => {
    const otherUserCompletedJob = {
      id: "other-completed-job",
      userId: "other-user-id",
      repository: "owner/repo",
      branch: "main",
      prompt: "test",
      status: "COMPLETED",
      platform: "API",
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    };
    mockJobFindUnique.mockResolvedValueOnce(otherUserCompletedJob);
    mockJobLogFindMany.mockResolvedValueOnce([]);

    const { app } = await import("../../index.js");
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const adminToken = makeToken("ADMIN", "admin-user-id");
      const response = await fetch(`http://localhost:${port}/api/jobs/other-completed-job/stream`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.status).toBe(200);
      await response.body?.cancel();
    } finally {
      (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
