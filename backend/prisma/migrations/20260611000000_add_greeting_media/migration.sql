-- AlterTable
ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "greeting_media" JSONB NOT NULL DEFAULT '[]';
