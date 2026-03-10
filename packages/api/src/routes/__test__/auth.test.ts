import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted で vi.mock() ファクトリ内から参照できるモック関数を定義
const { mockRedisGet, mockRedisDel, mockRedisSet, mockUserUpsert, mockAccountLinkUpsert } =
  vi.hoisted(() => ({
    mockRedisGet: vi.fn().mockResolvedValue(null),
    mockRedisDel: vi.fn().mockResolvedValue(1),
    mockRedisSet: vi.fn().mockResolvedValue("OK"),
    mockUserUpsert: vi.fn().mockResolvedValue({
      id: "test-user-id",
      githubUsername: "testuser",
      githubAvatarUrl: "https://github.com/avatars/testuser",
      role: "USER",
    }),
    mockAccountLinkUpsert: vi.fn().mockResolvedValue({}),
  }));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    job: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "job-id", status: "PENDING" }),
      update: vi.fn().mockResolvedValue({ id: "job-id" }),
    },
    jobLog: { findMany: vi.fn().mockResolvedValue([]) },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "test-user-id",
        githubUsername: "testuser",
        githubAvatarUrl: null,
        role: "USER",
      }),
      upsert: mockUserUpsert,
    },
    accountLink: {
      upsert: mockAccountLinkUpsert,
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
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
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

// token-vault の encrypt をモック（実際の暗号化をスキップ）
vi.mock("../../services/token-vault.js", () => ({
  encrypt: vi.fn().mockReturnValue("encrypted-token"),
  decrypt: vi.fn().mockReturnValue("decrypted-token"),
}));

/** GitHub OAuth トークン交換レスポンスのモック */
const mockGithubTokenResponse = {
  access_token: "mock-access-token",
  refresh_token: "mock-refresh-token",
  expires_in: 28800,
  refresh_token_expires_in: 15897600,
};

/** GitHub ユーザー情報のモック */
const mockGithubUser = {
  id: 12345,
  login: "testuser",
  avatar_url: "https://github.com/avatars/testuser",
  email: "testuser@example.com",
};

/** fetch をモックして GitHub API コールを差し替える */
function setupFetchMock() {
  const mockFetch = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes("login/oauth/access_token")) {
      return {
        ok: true,
        json: () => mockGithubTokenResponse,
      };
    }
    if (String(url).includes("api.github.com/user")) {
      return {
        ok: true,
        json: () => mockGithubUser,
      };
    }
    throw new Error(`Unexpected fetch URL: ${String(url)}`);
  });
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

describe("GET /api/auth/github/callback (OAuth コールバック統合テスト)", () => {
  beforeEach(() => {
    process.env["JWT_SECRET"] = "test-jwt-secret-auth";
    process.env["REDIS_URL"] = "redis://localhost:6379";
    process.env["TOKEN_ENCRYPTION_KEY"] = "0".repeat(64);
    process.env["GITHUB_APP_CLIENT_ID"] = "test-client-id";
    process.env["GITHUB_APP_CLIENT_SECRET"] = "test-client-secret";
    process.env["APP_URL"] = "http://localhost:3000";

    mockRedisGet.mockReset();
    mockRedisDel.mockReset();
    mockRedisSet.mockReset();
    mockRedisGet.mockResolvedValue(null);
    mockRedisDel.mockResolvedValue(1);
    mockRedisSet.mockResolvedValue("OK");

    mockUserUpsert.mockReset();
    mockUserUpsert.mockResolvedValue({
      id: "test-user-id",
      githubUsername: "testuser",
      githubAvatarUrl: "https://github.com/avatars/testuser",
      role: "USER",
    });

    mockAccountLinkUpsert.mockReset();
    mockAccountLinkUpsert.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("code または state が欠けている場合は 400 が返る", async () => {
    const { app } = await import("../../index.js");

    // code なし
    const res1 = await request(app).get("/api/auth/github/callback?state=test-state");
    expect(res1.status).toBe(400);

    // state なし
    const res2 = await request(app).get("/api/auth/github/callback?code=test-code");
    expect(res2.status).toBe(400);

    // 両方なし
    const res3 = await request(app).get("/api/auth/github/callback");
    expect(res3.status).toBe(400);
  });

  it("無効または期限切れの state は 400 が返る", async () => {
    mockRedisGet.mockResolvedValueOnce(null); // state が Redis に存在しない

    const { app } = await import("../../index.js");
    const response = await request(app).get(
      "/api/auth/github/callback?code=test-code&state=invalid-state",
    );
    expect(response.status).toBe(400);
    expect(response.text).toContain("Invalid or expired state");
  });

  it("Web OAuth フロー: JWT を含むリダイレクトが実行される", async () => {
    setupFetchMock();

    const stateData = JSON.stringify({
      platform: "web",
      redirectUrl: "http://localhost:5173",
    });
    mockRedisGet.mockResolvedValueOnce(stateData);

    const { app } = await import("../../index.js");
    const response = await request(app)
      .get("/api/auth/github/callback?code=test-code&state=valid-web-state")
      .redirects(0); // リダイレクトを追わない

    expect(response.status).toBe(302);
    expect(response.headers["location"]).toContain("/auth/callback");
    expect(response.headers["location"]).toContain("token=");
    expect(response.headers["location"]).toContain("role=USER");

    // ユーザーがアップサートされたことを確認
    expect(mockUserUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { githubUsername: "testuser" },
      }),
    );

    // Redis の state が削除されたことを確認 (CSRF トークン消費)
    expect(mockRedisDel).toHaveBeenCalledWith("oauth:state:valid-web-state");
  });

  it("Slack OAuth フロー: AccountLink 登録と Slack DM 通知が実行される", async () => {
    const mockFetch = setupFetchMock();
    // Slack pending task なし
    mockRedisGet
      .mockResolvedValueOnce(
        JSON.stringify({
          platform: "slack",
          slackUserId: "U1234567",
        }),
      )
      .mockResolvedValueOnce(null); // pending task なし

    const { app } = await import("../../index.js");

    await request(app)
      .get("/api/auth/github/callback?code=test-slack-code&state=valid-slack-state")
      .redirects(0);

    // GitHub API が呼ばれたことを確認
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("login/oauth/access_token"),
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("api.github.com/user"),
      expect.any(Object),
    );

    // AccountLink が作成されたことを確認
    expect(mockAccountLinkUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          platform_platformUserId: {
            platform: "SLACK",
            platformUserId: "U1234567",
          },
        },
      }),
    );
  });

  it("Slack OAuth フロー: pending task がある場合は続行ボタンつきで DM 通知", async () => {
    setupFetchMock();
    mockRedisGet
      .mockResolvedValueOnce(
        JSON.stringify({
          platform: "slack",
          slackUserId: "U9999999",
        }),
      )
      .mockResolvedValueOnce("owner/repo main バグを修正してください"); // pending task あり

    const { app } = await import("../../index.js");
    await request(app)
      .get("/api/auth/github/callback?code=test-pending-code&state=valid-pending-state")
      .redirects(0);

    // mock.results[0].value がコンストラクタの返り値 (= slackClient)
    const { WebClient } = await import("@slack/web-api");
    const slackInstance = vi.mocked(WebClient).mock.results[0]?.value as
      | { chat: { postMessage: ReturnType<typeof vi.fn> } }
      | undefined;

    // Slack DM が送信されたことを確認 (channel + blocks に resume_pending_task ボタンを含む)
    expect(slackInstance?.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "U9999999",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "actions",
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            elements: expect.arrayContaining([
              expect.objectContaining({ action_id: "resume_pending_task" }),
            ]),
          }),
        ]),
      }),
    );
  });

  it("GitHub API エラー時は 500 が返る", async () => {
    // fetch が token exchange でエラーを返す
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => ({ error: "bad_verification_code", error_description: "Invalid code" }),
      }),
    );

    mockRedisGet.mockResolvedValueOnce(
      JSON.stringify({
        platform: "web",
        redirectUrl: "http://localhost:5173",
      }),
    );

    const { app } = await import("../../index.js");
    const response = await request(app).get(
      "/api/auth/github/callback?code=bad-code&state=valid-state",
    );
    expect(response.status).toBe(500);
  });
});
