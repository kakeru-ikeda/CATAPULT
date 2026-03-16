-- AlterTable: Skill テーブルに isSystem フラグを追加
-- true のスキルはシステム組み込みスキルとして API からの削除・変更を禁止する

ALTER TABLE "Skill" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;
