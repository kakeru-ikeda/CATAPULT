#!/usr/bin/env node

import { hostname } from "os";
import { createInterface } from "readline";

import { Command } from "commander";

import { startMainLoop } from "./agent.js";
import { loadConfig, saveConfig, getConfigPath } from "./config.js";

const program = new Command();

program.name("catapult-agent").description("CATAPULT ローカルエージェント").version("0.1.0");

program
  .command("init")
  .description("ローカルエージェントを初期化してサーバーに登録します")
  .action(async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

    console.info("=== CATAPULT ローカルエージェント セットアップ ===\n");

    const apiUrl = (await ask("CATAPULT サーバーの URL: ")).trim().replace(/\/$/, "");
    const defaultName = hostname();
    const nameInput = (await ask(`このマシンの名前 [${defaultName}]: `)).trim();
    const name = nameInput || defaultName;
    const workspaceRoot =
      (await ask("ローカルのワークスペース親フォルダ (例: ~/projects): ")).trim() || "~/projects";

    rl.close();

    // JWT トークンを取得するために一時的にログインが必要
    // ここでは CATAPULT の Web UI でログインして JWT を取得する方法を案内する
    console.info("\n次の手順で JWT トークンを取得してください:");
    console.info(`  1. ${apiUrl} に Web ブラウザでアクセス`);
    console.info(
      "  2. GitHub でログイン後、ブラウザの開発者ツールで localStorage の 'token' を確認",
    );
    console.info("  3. 以下に貼り付け\n");

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
