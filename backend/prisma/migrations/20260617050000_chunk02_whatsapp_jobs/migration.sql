ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "delivery_status" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "meta_message_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "failed_reason" TEXT;

CREATE TABLE IF NOT EXISTS "whatsapp_jobs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL REFERENCES "companies"("id"),
  "job_type" VARCHAR(50) NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL UNIQUE,
  "payload" JSONB NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "last_error" TEXT,
  "next_attempt_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "processed_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "whatsapp_jobs_company_status_idx"
  ON "whatsapp_jobs"("company_id", "status");

CREATE INDEX IF NOT EXISTS "whatsapp_jobs_status_next_attempt_idx"
  ON "whatsapp_jobs"("status", "next_attempt_at");

CREATE INDEX IF NOT EXISTS "whatsapp_jobs_created_at_idx"
  ON "whatsapp_jobs"("created_at");

CREATE TABLE IF NOT EXISTS "whatsapp_dead_letters" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_id" UUID NOT NULL,
  "company_id" UUID NOT NULL REFERENCES "companies"("id"),
  "payload" JSONB NOT NULL,
  "error" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "whatsapp_dead_letters_company_created_idx"
  ON "whatsapp_dead_letters"("company_id", "created_at");

CREATE INDEX IF NOT EXISTS "whatsapp_dead_letters_job_id_idx"
  ON "whatsapp_dead_letters"("job_id");
