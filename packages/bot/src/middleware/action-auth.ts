import type {
  BlockAction,
  Middleware,
  SlackActionMiddlewareArgs,
  AllMiddlewareArgs,
} from "@slack/bolt";

/**
 * ボタン操作の本人認証ミドルウェア.
 * ボタンの value の末尾が ":<slackUserId>" 形式であることを前提とする.
 */
export const validateActionOwner: Middleware<SlackActionMiddlewareArgs<BlockAction>> = async ({
  action,
  body,
  respond,
  next,
}: SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs) => {
  const operatorId = body.user.id;
  const value = "value" in action ? action.value : undefined;

  if (value) {
    const parts = value.split(":");
    const ownerId = parts[parts.length - 1];

    if (ownerId && ownerId.startsWith("U") && operatorId !== ownerId) {
      await respond({
        text: "このアクションを実行する権限がありません。",
        response_type: "ephemeral",
        replace_original: false,
      });
      return;
    }
  }

  await next();
};
