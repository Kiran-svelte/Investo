-- Enterprise chunks 06–14: compliance, DR, data platform, public API, billing, support, config, governance

CREATE TABLE IF NOT EXISTS "data_subject_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "request_type" VARCHAR(30) NOT NULL,
  "subject_phone" VARCHAR(20),
  "subject_email" VARCHAR(255),
  "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
  "requested_by" UUID NOT NULL,
  "completed_at" TIMESTAMP(3),
  "artifact_path" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_subject_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "data_subject_requests_company_id_status_idx" ON "data_subject_requests"("company_id", "status");
CREATE INDEX IF NOT EXISTS "data_subject_requests_company_id_created_at_idx" ON "data_subject_requests"("company_id", "created_at");

CREATE TABLE IF NOT EXISTS "retention_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "lead_days" INTEGER NOT NULL DEFAULT 2555,
  "message_days" INTEGER NOT NULL DEFAULT 1095,
  "audit_days" INTEGER NOT NULL DEFAULT 2555,
  "inactive_company_days" INTEGER NOT NULL DEFAULT 90,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retention_policies_company_id_key" UNIQUE ("company_id"),
  CONSTRAINT "retention_policies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "legal_holds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "entity_type" VARCHAR(50) NOT NULL,
  "entity_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "placed_by" UUID NOT NULL,
  "released_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legal_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legal_holds_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "legal_holds_company_id_entity_type_entity_id_idx" ON "legal_holds"("company_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "legal_holds_company_id_released_at_idx" ON "legal_holds"("company_id", "released_at");

CREATE TABLE IF NOT EXISTS "dpa_acceptances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "accepted_by" UUID NOT NULL,
  "version" VARCHAR(50) NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dpa_acceptances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dpa_acceptances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "dpa_acceptances_company_id_version_idx" ON "dpa_acceptances"("company_id", "version");

CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "event_type" VARCHAR(100) NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "outbox_events_company_id_status_idx" ON "outbox_events"("company_id", "status");
CREATE INDEX IF NOT EXISTS "outbox_events_status_created_at_idx" ON "outbox_events"("status", "created_at");

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "key_prefix" VARCHAR(20) NOT NULL,
  "key_hash" VARCHAR(255) NOT NULL,
  "scopes" JSONB NOT NULL DEFAULT '[]',
  "last_used_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_by" UUID NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_keys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "api_keys_company_id_idx" ON "api_keys"("company_id");
CREATE INDEX IF NOT EXISTS "api_keys_key_prefix_idx" ON "api_keys"("key_prefix");

CREATE TABLE IF NOT EXISTS "webhook_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "url" VARCHAR(500) NOT NULL,
  "secret_hash" VARCHAR(255) NOT NULL,
  "events" JSONB NOT NULL DEFAULT '[]',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "webhook_subscriptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_company_id_active_idx" ON "webhook_subscriptions"("company_id", "active");

CREATE TABLE IF NOT EXISTS "usage_invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "total_inr" DECIMAL(14,2) NOT NULL,
  "line_items" JSONB NOT NULL DEFAULT '[]',
  "status" VARCHAR(30) NOT NULL DEFAULT 'draft',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usage_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "usage_invoices_company_id_period_start_period_end_key" ON "usage_invoices"("company_id", "period_start", "period_end");
CREATE INDEX IF NOT EXISTS "usage_invoices_company_id_status_idx" ON "usage_invoices"("company_id", "status");

CREATE TABLE IF NOT EXISTS "support_impersonations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "support_user_id" UUID NOT NULL,
  "target_user_id" UUID NOT NULL,
  "ticket_id" VARCHAR(100) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_impersonations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_impersonations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "support_impersonations_company_id_expires_at_idx" ON "support_impersonations"("company_id", "expires_at");
CREATE INDEX IF NOT EXISTS "support_impersonations_support_user_id_idx" ON "support_impersonations"("support_user_id");

CREATE TABLE IF NOT EXISTS "tenant_health_scores" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "score" INTEGER NOT NULL,
  "signals" JSONB NOT NULL DEFAULT '{}',
  "computed_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_health_scores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_health_scores_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "tenant_health_scores_company_id_computed_at_idx" ON "tenant_health_scores"("company_id", "computed_at");

CREATE TABLE IF NOT EXISTS "sandbox_tenants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "sandbox_company_id" UUID NOT NULL,
  "pii_scrubbed" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sandbox_tenants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sandbox_tenants_company_id_key" UNIQUE ("company_id"),
  CONSTRAINT "sandbox_tenants_sandbox_company_id_key" UNIQUE ("sandbox_company_id"),
  CONSTRAINT "sandbox_tenants_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "prompt_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(100) NOT NULL,
  "version" VARCHAR(50) NOT NULL,
  "content" TEXT NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'draft',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "prompt_versions_name_version_key" ON "prompt_versions"("name", "version");

CREATE TABLE IF NOT EXISTS "ai_review_queue_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "risk_score" INTEGER NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
  "reviewed_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_review_queue_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_review_queue_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ai_review_queue_items_company_id_status_idx" ON "ai_review_queue_items"("company_id", "status");
CREATE INDEX IF NOT EXISTS "ai_review_queue_items_message_id_idx" ON "ai_review_queue_items"("message_id");

CREATE TABLE IF NOT EXISTS "message_archives" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_archives_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_archives_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "message_archives_company_id_message_id_key" ON "message_archives"("company_id", "message_id");
CREATE INDEX IF NOT EXISTS "message_archives_company_id_created_at_idx" ON "message_archives"("company_id", "created_at");
