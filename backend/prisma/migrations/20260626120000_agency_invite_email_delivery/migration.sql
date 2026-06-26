ALTER TABLE "agency_invites"
  ADD COLUMN IF NOT EXISTS "email_delivery_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "email_last_attempt_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "email_sent_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "email_message_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "email_last_error" TEXT;

UPDATE "agency_invites"
SET "email_delivery_status" = CASE
  WHEN "email_sent_at" IS NOT NULL THEN 'sent'
  ELSE "email_delivery_status"
END;
