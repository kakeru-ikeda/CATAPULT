import express from "express";

import { authRouter } from "./routes/auth.js";

const app = express();
const PORT = process.env["PORT"] ?? 3000;

app.use(express.json());

// ヘルスチェック
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// 認証ルート
app.use("/api/auth", authRouter);

app.listen(PORT, () => {
  console.info(`🚀 CATAPULT API Server is running on port ${PORT}`);
});
