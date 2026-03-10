/**
 * E2Eテスト: ジョブ作成 → 実行 → 完了フロー
 *
 * 外部依存をすべてモックした状態で、以下のフローを検証する:
 *  1. POST /api/jobs でジョブを作成
 *  2. GET /api/jobs/:id/stream で SSE ストリームに接続
 *  3. Redis Pub/Sub でワーカーイベントをシミュレート
 *  4. SSE クライアントがイベントを受信
 *  5. GET /api/jobs/:id でジョブ最終状態を確認
 */
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const JOB_ID = "e2e-test-job-id";

const {
  mockJobFindUnique,
  mockJobLogFindMany,
  mockJobCreate,
  mockJobUpdate,
  mockSubscriberOn,
  mockSubscriberSubscribe,
  mockRedisDuplicate,
  mockQueueAdd,
} = vi.hoisted(() => ({
  mockJobFindUnique: vi.fn(),
  mockJobLogFindMany: vi.fn().mockResolvedValue([]),
  mockJobCreate: vi.fn(),
  mockJobUpdate: vi.fn(),
  mockSubscriberOn: vi.fn(),
  mockSubscriberSubscribe: vi.fn().mockResolvedValue(null),
  mockRedisDuplicate: vi.fn(),
  mockQueueAdd: vi.fn().mockResolvedValue({ id: "bull-job-id" }),
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    job: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: mockJobFindUnique,
      create: mockJobCreate,
      update: mockJobUpdate,
      findUniqueOrThrow: vi.fn().mockResolvedValue(null),
    },
    jobLog: { findMany: mockJobLogFindMany },
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
    add: mockQueueAdd,
  })),
}));

vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    chat: { postMessage: vi.fn().mockResolvedValue({ ok: true }) },
  })),
}));

const TEST_JWT_SECRET = "test-jwt-secret-e2e";

function makeToken(userId = "test-user-id") {
  return jwt.sign({ id: userId, role: "USER", githubUsername: "testuser" }, TEST_JWT_SECRET, {
    expiresIn: "1h",
  });
}

const pendingJob = {
  id: JOB_ID,
  userId: "test-user-id",
  repository: "owner/repo",
  branch: "main",
  prompt: "バグを修正してPRを作成してください",
  status: "PENDING",
  platform: "API",
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
};

describe("E2E: ジョブ作成 → 実行 → 完了フロー", () => {
  beforeEach(() => {
    process.env["JWT_SECRET"] = TEST_JWT_SECRET;
    process.env["REDIS_URL"] = "redis://localhost:6379";
    process.env["TOKEN_ENCRYPTION_KEY"] = "0".repeat(64);

    mockJobCreate.mockReset();
    mockJobCreate.mockResolvedValue(pendingJob);

    mockJobFindUnique.mockReset();
    mockJobFindUnique.mockResolvedValue(null);

    mockJobLogFindMany.mockReset();
    mockJobLogFindMany.mockResolvedValue([]);

    mockJobUpdate.mockReset();
    mockJobUpdate.mockResolvedValue({ ...pendingJob, status: "COMPLETED" });

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

    mockQueueAdd.mockReset();
    mockQueueAdd.mockResolvedValue({ id: "bull-job-id" });
  });

  it("ジョブを作成するとBullMQキューに追加される", async () => {
    const { app } = await import("../../index.js");
    const token = makeToken();

    const response = await fetch(`http://localhost:${await getServerPort(app)}/api/jobs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repository: "owner/repo",
        branch: "main",
        prompt: "バグを修正してPRを作成してください",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; status: string };
    expect(body.status).toBe("PENDING");
    expect(body.id).toBe(JOB_ID);

    // BullMQ キューに投入されたことを確認
    expect(mockQueueAdd).toHaveBeenCalledWith("execute", { jobId: JOB_ID });
  });

  it("SSEストリームでワーカーイベントをリアルタイム受信できる", async () => {
    // PENDING ジョブとして findUnique が返す
    mockJobFindUnique.mockResolvedValue(pendingJob);

    const { app } = await import("../../index.js");
    const port = await getServerPort(app);
    const token = makeToken();
    const controller = new AbortController();

    try {
      // SSE ストリームに接続
      const sseResponse = await fetch(`http://localhost:${port}/api/jobs/${JOB_ID}/stream`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      });

      expect(sseResponse.status).toBe(200);
      expect(sseResponse.headers.get("content-type")).toBe("text/event-stream");

      // Redis 購読が開始されるまで待機
      await vi.waitFor(
        () => {
          expect(mockSubscriberSubscribe).toHaveBeenCalledWith(`job:${JOB_ID}`);
        },
        { timeout: 2000 },
      );

      // SSE データを収集するリーダーを起動
      const receivedChunks: string[] = [];
      const reader = (sseResponse.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      const readPromise = (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            receivedChunks.push(decoder.decode(value));
          }
        } catch {
          // AbortError は正常終了として無視
        }
      })();

      // ワーカーのイベント送信をシミュレート (Redis Pub/Sub)
      const messageHandler = mockSubscriberOn.mock.calls.find(
        (c) => (c as unknown[])[0] === "message",
      )?.[1] as ((channel: string, message: string) => void) | undefined;

      expect(messageHandler).toBeDefined();

      if (messageHandler) {
        messageHandler(
          `job:${JOB_ID}`,
          JSON.stringify({ type: "agent_step", content: "コードを分析中..." }),
        );
        messageHandler(
          `job:${JOB_ID}`,
          JSON.stringify({ type: "tool_call", content: "read_file: src/index.ts" }),
        );
        messageHandler(
          `job:${JOB_ID}`,
          JSON.stringify({
            type: "done",
            content: "完了",
            prUrl: "https://github.com/owner/repo/pull/1",
          }),
        );
      }

      // イベントが SSE クライアントに届くまで待機
      await vi.waitFor(
        () => {
          const allData = receivedChunks.join("");
          expect(allData).toContain("agent_step");
          expect(allData).toContain("tool_call");
          expect(allData).toContain("done");
        },
        { timeout: 2000 },
      );

      const allData = receivedChunks.join("");
      expect(allData).toContain("コードを分析中...");
      expect(allData).toContain("read_file: src/index.ts");
      expect(allData).toContain("https://github.com/owner/repo/pull/1");

      controller.abort();
      await readPromise;
    } finally {
      controller.abort();
    }
  });

  it("ジョブ作成 → 完了フローの一連の状態遷移が正常に動作する", async () => {
    const completedJob = {
      ...pendingJob,
      status: "COMPLETED",
      completedAt: new Date(),
    };

    const { app } = await import("../../index.js");
    const port = await getServerPort(app);
    const token = makeToken();

    // Step 1: ジョブ作成
    const createResponse = await fetch(`http://localhost:${port}/api/jobs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repository: "owner/repo",
        branch: "main",
        prompt: "リファクタリングしてください",
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdJob = (await createResponse.json()) as { id: string; status: string };
    expect(createdJob.id).toBe(JOB_ID);
    expect(createdJob.status).toBe("PENDING");

    // Step 2: ジョブが BullMQ に追加されたことを確認
    expect(mockQueueAdd).toHaveBeenCalledWith("execute", { jobId: JOB_ID });

    // Step 3: 完了後のジョブ詳細取得
    mockJobFindUnique.mockResolvedValueOnce(completedJob);
    const detailResponse = await fetch(`http://localhost:${port}/api/jobs/${JOB_ID}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detailResponse.status).toBe(200);
    const jobDetail = (await detailResponse.json()) as { status: string; completedAt: string };
    expect(jobDetail.status).toBe("COMPLETED");
    expect(jobDetail.completedAt).toBeDefined();
  });
});

// ===== ヘルパー: テスト用サーバーを起動してポートを返す =====

let _testServer: Server | null = null;
let _testPort: number | null = null;

async function getServerPort(app: { listen: (port: number) => Server }) {
  if (_testPort !== null) return _testPort;
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  _testPort = (server.address() as AddressInfo).port;
  _testServer = server;
  return _testPort;
}
