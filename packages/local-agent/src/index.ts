#!/usr/bin/env node

import { execFileSync } from "child_process";
import { hostname } from "os";
import { createInterface } from "readline";

import { Command } from "commander";

import { startMainLoop } from "./agent.js";
import { loadConfig, saveConfig, getConfigPath } from "./config.js";

function validateCopilotCli(): void {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    execFileSync(finder, ["copilot"], { stdio: "ignore" });
  } catch {
    console.error(
      "エラー: GitHub Copilot CLI (copilot) が見つかりません。\n" +
        "以下のコマンドでインストールしてください:\n" +
        "  npm install -g @githubnext/github-copilot-cli\n" +
        "インストール後、`github-copilot-cli auth` で認証を行ってください。",
    );
    process.exit(1);
  }
}

const program = new Command();

program.name("catapult-agent").description("CATAPULT ローカルエージェント").version("0.1.0");

program
  .command("init")
  .description("ローカルエージェントを初期化してサーバーに登録します")
  .action(async () => {
    validateCopilotCli();

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

    console.info("=== CATAPULT ローカルエージェント セットアップ ===\n");

    const apiUrl = (
      await ask("CATAPULT API サーバーの URL (例: https://api.catapult.example.com): ")
    )
      .trim()
      .replace(/\/$/, "");
    const frontendUrl = (await ask("CATAPULT 管理画面の URL (例: https://catapult.example.com): "))
      .trim()
      .replace(/\/$/, "");
    const defaultName = hostname();
    const nameInput = (await ask(`このマシンの名前 [${defaultName}]: `)).trim();
    const name = nameInput || defaultName;
    const workspaceRoot =
      (await ask("ローカルのワークスペース親フォルダ (例: ~/projects): ")).trim() || "~/projects";

    rl.close();

    // JWT トークンを取得するために一時的にログインが必要
    // ここでは CATAPULT の管理画面（フロントエンド）でログインして JWT を取得する方法を案内する
    console.info("\n次の手順で JWT トークンを取得してください:");
    console.info(`  1. 管理画面 ( ${frontendUrl} ) に Web ブラウザでアクセス`);
    console.info("  2. GitHub でログイン");
    console.info(
      "  3. ブラウザの開発者ツール → Application → Local Storage → 'token' の値をコピー",
    );
    console.info("  4. 以下に貼り付け\n");

    const rl2 = createInterface({ input: process.stdin, output: process.stdout });
    const ask2 = (q: string): Promise<string> => new Promise((resolve) => rl2.question(q, resolve));

    const jwtToken = (await ask2("JWT トークン: ")).trim();
    rl2.close();

    // エージェントを登録
    try {
      const res = await fetch(`${apiUrl}/api/agents/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwtToken}`,
        },
        body: JSON.stringify({ name, workspaceRoot }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`登録に失敗しました: ${res.status} ${body}`);
        process.exit(1);
      }

      const data = (await res.json()) as { agentToken: string; agentId: string };

      saveConfig({
        apiUrl,
        agentToken: data.agentToken,
        name,
        workspaceRoot,
      });

      console.info(`\n✅ 登録完了!`);
      console.info(`エージェント ID: ${data.agentId}`);
      console.info(`設定ファイル: ${getConfigPath()}`);
      console.info(`\n以下のコマンドでエージェントを起動できます:`);
      console.info(`  npx catapult-agent start`);
    } catch (err) {
      console.error("登録中にエラーが発生しました:", err);
      process.exit(1);
    }
  });

program
  .command("start")
  .description("ローカルエージェントデーモンを起動します")
  .action(async () => {
    validateCopilotCli();

    const config = loadConfig();
    if (!config) {
      console.error(
        "設定ファイルが見つかりません。先に `catapult-agent init` を実行してください。",
      );
      process.exit(1);
    }
    await startMainLoop(config);
  });

program.parse(process.argv);
