import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, it, expect, vi, beforeAll } from "vitest";

// 外部依存をモック
vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    job: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "test-job-id",
        userId: "test-user-id",
        repository: "owner/repo",
        branch: "main",
        prompt: "バグを修正してください",
        status: "PENDING",
        platform: "API",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: vi.fn().mockResolvedValue({
        id: "test-job-id",
        status: "CANCELLED",
      }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(null),
    },
    jobLog: {
      findMany: vi.fn().mockResolvedValue([]),
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
    duplicate: vi.fn().mockReturnThis(),
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

const TEST_JWT_SECRET = "test-jwt-secret";

function makeToken(role: "USER" | "ADMIN" = "USER") {
  return jwt.sign({ id: "test-user-id", role, githubUsername: "testuser" }, TEST_JWT_SECRET, {
    expiresIn: "1h",
  });
}

describe("Jobs API", () => {
  beforeAll(() => {
    process.env["JWT_SECRET"] = TEST_JWT_SECRET;
    process.env["REDIS_URL"] = "redis://localhost:6379";
    process.env["TOKEN_ENCRYPTION_KEY"] = "0".repeat(64);
  });

  describe("POST /api/jobs", () => {
    it("有効なリクエストでジョブが作成される", async () => {
      const { app } = await import("../../index.js");
      const token = makeToken();
      const response = await request(app)
        .post("/api/jobs")
        .set("Authorization", `Bearer ${token}`)
        .send({
          repository: "owner/repo",
          branch: "main",
          prompt: "バグを修正してPRを作成してください",
        });

      expect(response.status).toBe(201);
      expect((response.body as { status: string }).status).toBe("PENDING");
    });

    it("未認証では 401 が返る", async () => {
      const { app } = await import("../../index.js");
      const response = await request(app).post("/api/jobs").send({});
      expect(response.status).toBe(401);
    });

    it("必須フィールドが欠けている場合は 400 が返る", async () => {
      const { app } = await import("../../index.js");
      const token = makeToken();
      const response = await request(app)
        .post("/api/jobs")
        .set("Authorization", `Bearer ${token}`)
        .send({ repository: "owner/repo" }); // branch と prompt が欠けている

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/jobs", () => {
    it("認証済みユーザーはジョブ一覧を取得できる", async () => {
      const { app } = await import("../../index.js");
      const token = makeToken();
      const response = await request(app).get("/api/jobs").set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it("未認証では 401 が返る", async () => {
      const { app } = await import("../../index.js");
      const response = await request(app).get("/api/jobs");
      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/jobs/:id (キャンセル)", () => {
    it("存在しないジョブは 404 が返る", async () => {
      const { app } = await import("../../index.js");
      const token = makeToken();
      const response = await request(app)
        .delete("/api/jobs/nonexistent-id")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(404);
    });

    it("未認証では 401 が返る", async () => {
      const { app } = await import("../../index.js");
      const response = await request(app).delete("/api/jobs/some-id");
      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/jobs/all (管理者)", () => {
    it("管理者権限なしでは 403 が返る", async () => {
      const { app } = await import("../../index.js");
      const token = makeToken("USER");
      const response = await request(app)
        .get("/api/jobs/all")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(403);
    });
  });
});
