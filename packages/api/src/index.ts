import express from "express";

import { agentsRouter } from "./routes/agents.js";
import { authRouter } from "./routes/auth.js";
import { instructionsRouter } from "./routes/instructions.js";
import { jobsRouter } from "./routes/jobs.js";
import { mcpToolsRouter } from "./routes/mcp-tools.js";
import { skillsRouter } from "./routes/skills.js";
import { usersRouter } from "./routes/users.js";

export const app = express();
const PORT = process.env["PORT"] ?? 3000;

app.use(express.json());

// CORS ヘッダー (開発時)
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env["FRONTEND_URL"] ?? "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range");
  next();
});

// ヘルスチェック
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// 認証ルート
app.use("/api/auth", authRouter);

// リソースルート
app.use("/api/users", usersRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/mcp-tools", mcpToolsRouter);
app.use("/api/instructions", instructionsRouter);
app.use("/api/skills", skillsRouter);
app.use("/api/agents", agentsRouter);

const server = app.listen(PORT, () => {
  console.info(`🚀 CATAPULT API Server is running on port ${PORT}`);
});

function shutdown(signal: string): void {
  console.info(`Received ${signal}, shutting down...`);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
