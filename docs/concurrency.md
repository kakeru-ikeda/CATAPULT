# CATAPULT - 同時実行安全性設計

## 概要

複数ユーザーが同時にジョブを実行する環境において、以下の6つの問題が発生しうるため、それぞれに対策を実装します。

---

## 1. Slack ボタンの操作権限

### 問題

Slack のインタラクティブコンポーネント（ボタン、セレクトメニューなど）は、同じチャンネルの誰でも操作できてしまいます。他のユーザーが起票したジョブのキャンセルボタンを押せてしまうのは問題です。

### 対策

ボタンの `value` にジョブを起票したユーザーの `slackUserId` を含め、操作者と起票者を照合するミドルウェアを実装します。

```typescript
// middleware/action-auth.ts

export async function validateActionOwner(
  payload: SlackActionPayload,
  next: () => void,
  respond: RespondFn,
): Promise<void> {
  const { value, action_id } = payload.actions[0];
  const operatorId = payload.user.id;

  // ボタン値から起票者 ID を抽出
  // 例: "cancel:job123:U12345678"
  const parts = value.split(":");
  const ownerId = parts[parts.length - 1];

  if (operatorId !== ownerId) {
    await respond({
      text: "このアクションを実行する権限がありません。",
      response_type: "ephemeral",
      replace_original: false,
    });
    return;
  }

  await next();
}
```

---

## 2. 同一ユーザーの重複ジョブ投入

### 問題

ユーザーが短時間に同じジョブを複数投入したり、多数のジョブを同時実行して他のユーザーのリソースを占有してしまう問題です。

### 対策: JobGuard

ジョブ投入時に以下の制限をチェックします。

```typescript
// services/job-guard.ts

const JOB_GUARD_CONFIG = {
  maxConcurrentPerUser: 3,   // ユーザーあたりの最大同時実行数
  maxConcurrentPerRepo: 2,   // リポジトリあたりの最大同時実行数
  maxDailyPerUser: 50,       // 1日あたりの最大ジョブ数
  cooldownMs: 10_000,        // 連続投入のクールダウン（10秒）
};

export class JobGuard {
  async check(userId: string, repository: string): Promise<void> {
    // 同時実行数チェック
    const runningByUser = await prisma.job.count({
      where: { userId, status: { in: ["PENDING", "RUNNING"] } },
    });
    if (runningByUser >= JOB_GUARD_CONFIG.maxConcurrentPerUser) {
      throw new JobLimitError(
        `同時実行できるジョブは最大 ${JOB_GUARD_CONFIG.maxConcurrentPerUser} 件です。`,
      );
    }

    // リポジトリごとの同時実行数チェック
    const runningByRepo = await prisma.job.count({
      where: { repository, status: { in: ["PENDING", "RUNNING"] } },
    });
    if (runningByRepo >= JOB_GUARD_CONFIG.maxConcurrentPerRepo) {
      throw new JobLimitError(
        `このリポジトリでは同時に最大 ${JOB_GUARD_CONFIG.maxConcurrentPerRepo} 件まで実行できます。`,
      );
    }

    // 1日あたりの上限チェック
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyCount = await prisma.job.count({
      where: { userId, createdAt: { gte: today } },
    });
    if (dailyCount >= JOB_GUARD_CONFIG.maxDailyPerUser) {
      throw new JobLimitError(`1日あたりのジョブ上限 (${JOB_GUARD_CONFIG.maxDailyPerUser}) に達しました。`);
    }

    // クールダウンチェック（Redis で最終投入時刻を管理）
    const lastJobKey = `job:last:${userId}`;
    const lastJobTime = await redis.get(lastJobKey);
    if (lastJobTime && Date.now() - parseInt(lastJobTime) < JOB_GUARD_CONFIG.cooldownMs) {
      const remaining = Math.ceil(
        (JOB_GUARD_CONFIG.cooldownMs - (Date.now() - parseInt(lastJobTime))) / 1000,
      );
      throw new JobLimitError(`次のジョブは ${remaining} 秒後に投入できます。`);
    }

    await redis.set(lastJobKey, Date.now().toString(), "EX", 60);
  }
}
```

---

## 3. キュー溢れ時の挙動

### 問題

キューにジョブが溜まっている場合、ユーザーはいつ実行されるのかわからず不安になります。

### 対策

ジョブ投入時にキュー内の順位と推定待ち時間を Slack/Discord に通知します。

```typescript
// services/queue-status.ts

export async function getQueuePosition(jobId: string): Promise<QueueStatus> {
  const waitingJobs = await bullQueue.getWaiting();
  const position = waitingJobs.findIndex((j) => j.id === jobId) + 1;

  // 直近10ジョブの平均実行時間から推定
  const recentJobs = await prisma.job.findMany({
    where: { status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    take: 10,
    select: { startedAt: true, completedAt: true },
  });

  const avgDurationMs =
    recentJobs.reduce((sum, j) => {
      if (!j.startedAt || !j.completedAt) return sum;
      return sum + (j.completedAt.getTime() - j.startedAt.getTime());
    }, 0) / recentJobs.length;

  const estimatedWaitMs = position * (avgDurationMs || 5 * 60 * 1000);

  return {
    position,
    estimatedWaitMinutes: Math.ceil(estimatedWaitMs / 60_000),
  };
}
```

通知メッセージ例:

```
📋 ジョブをキューに追加しました
現在の待ち順位: 3番目
推定待ち時間: 約10分
```

---

## 4. 作業ディレクトリの衝突

### 問題

複数のジョブが同じディレクトリでリポジトリをクローンすると、ファイルが競合します。

### 対策

ジョブ ID 単位で完全に分離された一時ディレクトリを使用します。

```typescript
// sandbox.ts

export function createWorkDir(jobId: string): string {
  const workDir = `/tmp/copilot-jobs/${jobId}/workspace`;
  fs.mkdirSync(workDir, { recursive: true });
  return workDir;
}

// git clone はディレクトリ名問題を排除するため末尾に . を付ける
async function cloneRepository(repoUrl: string, branch: string, workDir: string): Promise<void> {
  await execAsync(
    `git clone --depth=1 --branch=${branch} ${repoUrl} .`,
    { cwd: workDir },
  );
}

// 完了後のクリーンアップ
export async function cleanupWorkDir(jobId: string): Promise<void> {
  const workDir = `/tmp/copilot-jobs/${jobId}`;
  await fs.promises.rm(workDir, { recursive: true, force: true });
}
```

ディレクトリ構造:

```
/tmp/copilot-jobs/
├── job_abc123/
│   └── workspace/           ← ジョブ abc123 の作業ディレクトリ
│       ├── src/
│       ├── package.json
│       └── ...
└── job_def456/
    └── workspace/           ← ジョブ def456 の作業ディレクトリ
        ├── src/
        ├── package.json
        └── ...
```

---

## 5. 同一リポジトリ同時操作の git コンフリクト

### 問題

同じリポジトリに対して複数のジョブが同時に変更を加えると、ブランチ名が衝突したり、push 時にコンフリクトが発生します。

### 対策

#### 1. ブランチ名にジョブ ID の短縮形を含める

Copilot CLI に注入するインストラクションで、ブランチ名にジョブ ID を含めることを指示します。

```
作業ブランチを作成する際は、必ず以下の形式を使用してください:
  copilot/job-{JOB_SHORT_ID}/{機能名}
例: copilot/job-abc123/fix-login-bug
```

#### 2. `maxConcurrentPerRepo` による制限

JobGuard の `maxConcurrentPerRepo: 2` で、同一リポジトリに対する同時実行数を制限します。

これにより:
- ブランチ名の衝突を最小化
- リポジトリへの過剰な同時アクセスを防止

---

## 6. トークンリフレッシュの競合

### 問題

複数の Worker が同時に同じユーザーのトークンリフレッシュを試みると、不整合が発生します（古いトークンで上書きするなど）。

### 対策: 分散ロック + ダブルチェックパターン

```typescript
async function refreshWithLock(userId: string): Promise<string> {
  const lockKey = `token:refresh:lock:${userId}`;

  // Redis SET NX EX で分散ロックを取得（最大30秒）
  const lockAcquired = await redis.set(lockKey, "1", "EX", 30, "NX");

  if (!lockAcquired) {
    // ロック取得に失敗した場合はポーリングで待機（最大10秒）
    return await pollForFreshToken(userId, 10_000);
  }

  try {
    // ダブルチェック: ロック待ち中に別プロセスがリフレッシュ済みの可能性
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    if (user.tokenExpiresAt && user.tokenExpiresAt > fiveMinutesFromNow) {
      return decrypt(user.githubToken);
    }

    // 実際のリフレッシュ処理
    const newTokens = await githubApp.refreshUserToken(decrypt(user.refreshToken!));

    await prisma.user.update({
      where: { id: userId },
      data: {
        githubToken: encrypt(newTokens.token),
        refreshToken: encrypt(newTokens.refreshToken),
        tokenExpiresAt: newTokens.expiresAt,
        refreshTokenExpiresAt: newTokens.refreshTokenExpiresAt,
      },
    });

    return newTokens.token;
  } finally {
    await redis.del(lockKey);
  }
}

async function pollForFreshToken(userId: string, maxWaitMs: number): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    if (user.tokenExpiresAt && user.tokenExpiresAt > fiveMinutesFromNow) {
      return decrypt(user.githubToken);
    }
  }
  throw new Error("Token refresh timeout");
}
```

## まとめ

| 問題                         | 対策                                     |
| ---------------------------- | ---------------------------------------- |
| Slack ボタン操作権限          | ボタン値に起票者 ID を含めてミドルウェアで検証 |
| 重複ジョブ投入                | JobGuard（同時実行数・日次上限・クールダウン） |
| キュー溢れ                    | キュー位置と推定待ち時間を通知              |
| 作業ディレクトリ衝突          | ジョブ ID 単位の完全分離ディレクトリ        |
| git コンフリクト              | ブランチ名にジョブ ID 含める + maxConcurrentPerRepo: 2 |
| トークンリフレッシュ競合      | Redis 分散ロック + ダブルチェック + ポーリング |
