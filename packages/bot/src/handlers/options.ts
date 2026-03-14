import { PrismaClient } from "@prisma/client";
import type { App } from "@slack/bolt";

import { listInstallationRepos } from "../services/github-repos.js";

const prisma = new PrismaClient();

export function registerOptionsHandlers(app: App): void {
  app.options("select_repo", async ({ options, ack, payload }) => {
    // @slack/bolt の options payload は context に user が入っている場合がある
    // external_select payload の user は body.user.id から取得
    const slackUserId =
      "user" in payload && typeof payload.user === "object" && payload.user !== null
        ? (payload.user as { id: string }).id
        : undefined;

    const query = (options as unknown as { value?: string }).value ?? "";

    if (!slackUserId) {
      await ack({ options: [] });
      return;
    }

    const accountLink = await prisma.accountLink.findUnique({
      where: {
        platform_platformUserId: { platform: "SLACK", platformUserId: slackUserId },
      },
      select: { userId: true },
    });

    if (!accountLink) {
      await ack({ options: [] });
      return;
    }

    const repos = await listInstallationRepos(accountLink.userId, query);

    const noneOption = {
      text: { type: "plain_text" as const, text: "なし（コードベース不要）" },
      value: "__none__",
    };

    await ack({
      options: [
        noneOption,
        ...repos.slice(0, 99).map((repo) => ({
          text: { type: "plain_text" as const, text: repo.full_name },
          value: repo.full_name,
        })),
      ],
    });
  });
}
