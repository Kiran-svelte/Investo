ALTER TABLE "agency_invites"
  ADD COLUMN IF NOT EXISTS "email_delivered_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "email_last_event_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "email_last_event_id" VARCHAR(255);
