# Phase 3: Slack Bot 実装

## 目的

Slack のインターフェースとして、ユーザーが `@copilot` にメンションするだけで GitHub Copilot CLI のジョブを起動できる Bot を実装します。未連携ユーザーへの自動認証誘導、インタラクティブなリポジトリ・ブランチ選択、リアルタイム進捗投稿を実現します。

## 期間目安

**1週間**

## タスク一覧

### 1. Slack Bolt SDK セットアップ

```bash
npm install @slack/bolt
```

```typescript
// packages/bot/src/platforms/slack.ts

import { App, LogLevel } from "@slack/bolt";

export const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN!,
  logLevel: LogLevel.INFO,
});
```

### 2. メンション検知 (app_mention イベント)

```typescript
// packages/bot/src/handlers/mention.ts

slackApp.event("app_mention", async ({ event, client, say }) => {
  const slackUserId = event.user;
  const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();

  // アカウント連携確認
  const accountLink = await prisma.accountLink.findUnique({
    where: { platform_platformUserId: { platform: "SLACK", platformUserId: slackUserId } },
    include: { user: true },
  });

  if (!accountLink) {
    // 未連携: 認証誘導
    await handleUnauthenticatedUser(slackUserId, text, event, client);
    return;
  }

  // タスク処理
  await handleTask(accountLink.user, text, event, client);
});
```

### 3. 未連携ユーザーの自動認証誘導

```typescript
// packages/bot/src/handlers/mention.ts

async function handleUnauthenticatedUser(
  slackUserId: string,
  pendingTask: string,
  event: AppMentionEvent,
  client: WebClient,
): Promise<void> {
  // pendingTask を Redis に一時保存（TTL: 1時間）
  if (pendingTask) {
    await redis.set(`pending:task:${slackUserId}`, pendingTask, "EX", 3600);
  }

  // state 生成
  const state = crypto.randomBytes(32).toString("hex");
  await redis.set(
    `oauth:state:${state}`,
    JSON.stringify({ slackUserId, channelId: event.channel, threadTs: event.ts }),
    "EX",
    600,
  );

  const authUrl = `https://${process.env.API_BASE_URL}/api/auth/github?state=${state}&platform=slack`;

  // ephemeral メッセージで認証ボタンを表示
  await client.chat.postEphemeral({
    channel: event.channel,
    user: slackUserId,
    text: "GitHub アカウントと連携してください",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "CATAPULT を使うには GitHub アカウントとの連携が必要です。",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "GitHub で連携する 🔗" },
            url: authUrl,
            action_id: "github_auth",
          },
        ],
      },
    ],
  });
}
```

### 4. OAuth コールバック処理 + pendingTask の自動リトライ

```typescript
// packages/api/src/routes/auth.ts

router.get("/github/callback", async (req, res) => {
  const { code, state } = req.query;

  // state 検証（CSRF 防止）
  const stateData = await redis.get(`oauth:state:${state}`);
  if (!stateData) return res.status(400).send("Invalid state");
  await redis.del(`oauth:state:${state}`);

  const { slackUserId, channelId, threadTs } = JSON.parse(stateData);

  // トークン交換
  const tokens = await githubApp.getUserToken(code as string);
  const githubUser = await fetchGithubUser(tokens.token);

  // DB に保存
  const user = await prisma.user.upsert({ /* ... */ });
  await prisma.accountLink.upsert({ /* ... */ });

  // Slack DM で完了通知
  const pendingTask = await redis.get(`pending:task:${slackUserId}`);
  await slackApp.client.chat.postMessage({
    channel: slackUserId, // DM
    text: `✅ GitHub アカウント (${githubUser.login}) と連携しました！`,
    blocks: pendingTask
      ? [
          /* 「続行しますか？」ボタン */
        ]
      : undefined,
  });

  res.redirect("/auth/success");
});
```

### 5. タスク入力パターン

#### ワンライナーパターン

`@copilot owner/repo のXXXして` 形式の場合、リポジトリを自動検出して確認画面に進みます。

```typescript
// リポジトリを含む正規表現
const repoPattern = /([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/;
const match = text.match(repoPattern);

if (match) {
  // リポジトリ検証（GitHub App でインストール確認）
  const isValid = await githubRepos.verifyInstallation(user.id, match[1]);
  if (isValid) {
    await showConfirmation(/* ... */);
    return;
  }
}
```

#### インタラクティブパターン

リポジトリが指定されていない場合、`external_select` でリポジトリ選択を促します。

```typescript
// packages/bot/src/handlers/task.ts

await client.chat.postMessage({
  channel: channelId,
  thread_ts: threadTs,
  text: "どのリポジトリで作業しますか？",
  blocks: [
    {
      type: "actions",
      elements: [
        {
          type: "external_select",
          placeholder: { type: "plain_text", text: "リポジトリを選択..." },
          action_id: "select_repo",
          min_query_length: 0,
        },
      ],
    },
  ],
});
```

### 6. external_select のデータソース (options ハンドラー)

```typescript
// packages/bot/src/handlers/options.ts

slackApp.options("select_repo", async ({ options, ack, payload }) => {
  const slackUserId = payload.user?.id;
  const query = options.value ?? "";

  // GitHub App 経由でインストール済みリポジトリを取得（キャッシュあり）
  const repos = await githubRepos.listInstallationRepos(userId, query);

  await ack({
    options: repos.map((repo) => ({
      text: { type: "plain_text", text: repo.full_name },
      value: repo.full_name,
    })),
  });
});
```

### 7. ブランチ選択

リポジトリ選択後、ブランチ選択の UI を表示します。

```typescript
slackApp.action("select_repo", async ({ action, body, client, ack }) => {
  await ack();
  const repo = (action as BlockAction).selected_option!.value;

  const branches = await githubRepos.listBranches(userId, repo);

  await client.views.push({
    trigger_id: body.trigger_id,
    view: {
      type: "modal",
      callback_id: "select_branch",
      title: { type: "plain_text", text: "ブランチを選択" },
      blocks: [
        {
          type: "input",
          element: {
            type: "static_select",
            options: branches.map((b) => ({
              text: { type: "plain_text", text: b.name },
              value: b.name,
            })),
          },
          label: { type: "plain_text", text: "ブランチ" },
        },
      ],
    },
  });
});
```

### 8. ボタン本人認証ミドルウェア

`docs/concurrency.md` の「Slack ボタンの操作権限」対策を実装。

### 9. ジョブ投入 + キュー位置通知

```typescript
// ジョブ DB 登録
const job = await prisma.job.create({ /* ... */ });

// BullMQ にキュー投入
await jobQueue.add("execute", { jobId: job.id });

// キュー位置の取得・通知
const { position, estimatedWaitMinutes } = await getQueuePosition(job.id);
await client.chat.postMessage({
  channel: channelId,
  thread_ts: threadTs,
  text: `📋 ジョブをキューに追加しました\n現在の待ち順位: ${position}番目\n推定待ち時間: 約${estimatedWaitMinutes}分`,
});
```

### 10. JobStreamRelay (Pub/Sub → スレッド投稿)

`docs/streaming.md` の JobStreamRelay を実装。

```typescript
// packages/bot/src/services/job-stream.ts

const relay = new JobStreamRelay(job.id, slackApp, channelId, threadTs);
await relay.start();
```

### 11. バッファリング（2秒間隔）

`docs/streaming.md` のバッファリング実装を参照。

## 成果物

- `packages/bot/src/platforms/slack.ts` - Slack Bolt セットアップ
- `packages/bot/src/handlers/mention.ts` - メンション検知・認証誘導
- `packages/bot/src/handlers/task.ts` - タスク処理・インタラクティブ選択
- `packages/bot/src/handlers/options.ts` - external_select データソース
- `packages/bot/src/handlers/interactive.ts` - ボタン・モーダル操作
- `packages/bot/src/services/job-stream.ts` - JobStreamRelay
- `packages/bot/src/services/queue-status.ts` - キュー位置取得
- `packages/bot/src/middleware/action-auth.ts` - ボタン本人認証
- `packages/bot/src/formatters/slack-blocks.ts` - イベントフォーマット

## 完了条件

- [ ] `@copilot` メンションでメンションハンドラーが起動する
- [ ] 未連携ユーザーに ephemeral メッセージで認証ボタンが表示される
- [ ] OAuth 認証後に連携完了 DM が届く
- [ ] `pendingTask` が保存されていれば「続行しますか？」ボタンが表示される
- [ ] ワンライナーパターンでリポジトリが自動検出される
- [ ] インタラクティブパターンで `external_select` からリポジトリを選択できる
- [ ] ブランチ選択後に確認画面が表示される
- [ ] 確認後にジョブが投入され、キュー位置が通知される
- [ ] 実行中のジョブの進捗がスレッドにリアルタイム投稿される
- [ ] 自分以外のボタンを操作すると権限エラーが返る
