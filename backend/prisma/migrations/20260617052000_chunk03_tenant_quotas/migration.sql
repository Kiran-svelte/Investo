CREATE TABLE IF NOT EXISTS "company_quota_overrides" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "quotas" JSONB NOT NULL DEFAULT '{}',
  "reason" TEXT,
  "expires_at" TIMESTAMPTZ,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_quota_overrides_company_id_key"
  ON "company_quota_overrides"("company_id");

CREATE TABLE IF NOT EXISTS "tenant_usage_daily" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "date" DATE NOT NULL,
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_usage_daily_company_id_date_key"
  ON "tenant_usage_daily"("company_id", "date");

CREATE INDEX IF NOT EXISTS "tenant_usage_daily_date_idx"
  ON "tenant_usage_daily"("date");
