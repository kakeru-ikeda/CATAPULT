import { PrismaClient } from "@prisma/client";
import { Router } from "express";

const router = Router();
const prisma = new PrismaClient();

// GET /api/models
// enabled なモデルを sortOrder 順で返す
router.get("/", async (_req, res) => {
  const models = await prisma.copilotModel.findMany({
    where: { enabled: true },
    orderBy: { sortOrder: "asc" },
    select: { name: true, displayName: true },
  });
  res.json({ models });
});

export { router as modelsRouter };
