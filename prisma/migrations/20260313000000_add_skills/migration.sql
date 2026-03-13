-- CreateEnum
CREATE TYPE "SkillScope" AS ENUM ('GLOBAL', 'USER');

-- CreateTable
CREATE TABLE "Skill" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content"     TEXT NOT NULL,
    "scope"       "SkillScope" NOT NULL DEFAULT 'USER',
    "ownerId"     TEXT,
    "enabled"     BOOLEAN NOT NULL DEFAULT true,
    "version"     TEXT NOT NULL DEFAULT '1.0.0',
    "sourceZip"   BYTEA,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_scope_ownerId_key" ON "Skill"("name", "scope", "ownerId");

-- CreateIndex
CREATE INDEX "Skill_scope_enabled_idx" ON "Skill"("scope", "enabled");

-- AddForeignKey
ALTER TABLE "Skill"
    ADD CONSTRAINT "Skill_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
