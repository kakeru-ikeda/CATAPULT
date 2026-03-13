-- Instruction.userId を nullable に変更（グローバルインストラクション対応）
ALTER TABLE "Instruction" ALTER COLUMN "userId" DROP NOT NULL;

-- isGlobal フラグを追加
ALTER TABLE "Instruction" ADD COLUMN "isGlobal" BOOLEAN NOT NULL DEFAULT false;

-- インデックス追加
CREATE INDEX "Instruction_isGlobal_isActive_idx" ON "Instruction"("isGlobal", "isActive");
