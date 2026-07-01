-- INVESTO-FIX-2026-07-01: add structured media fields to messages so image/document/
-- video/audio/interactive messages can be rendered natively instead of collapsing
-- into a text summary.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "message_type" VARCHAR(20) NOT NULL DEFAULT 'text';
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "media_url" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "mime_type" VARCHAR(100);
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "media_caption" TEXT;
