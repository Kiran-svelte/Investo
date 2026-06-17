-- Chunk 04: Enterprise IAM (MFA, SSO, SCIM, branches)

CREATE TABLE IF NOT EXISTS "company_identity_configs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL UNIQUE REFERENCES "companies"("id") ON DELETE CASCADE,
  "sso_enabled" BOOLEAN NOT NULL DEFAULT false,
  "sso_provider" VARCHAR(50),
  "sso_connection_id" VARCHAR(255),
  "sso_oidc_issuer" VARCHAR(500),
  "sso_oidc_client_id" VARCHAR(255),
  "scim_enabled" BOOLEAN NOT NULL DEFAULT false,
  "scim_token_hash" VARCHAR(255),
  "mfa_required" BOOLEAN NOT NULL DEFAULT false,
  "mfa_methods" JSONB NOT NULL DEFAULT '["totp"]',
  "allowed_domains" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "user_mfa_devices" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "method" VARCHAR(20) NOT NULL,
  "secret_enc" TEXT,
  "webauthn_cred" JSONB,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "user_mfa_devices_user_id_method_idx" ON "user_mfa_devices"("user_id", "method");

CREATE TABLE IF NOT EXISTS "company_branches" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" VARCHAR(255) NOT NULL,
  "parent_id" UUID REFERENCES "company_branches"("id") ON DELETE SET NULL,
  "settings" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "company_branches_company_id_idx" ON "company_branches"("company_id");
CREATE INDEX IF NOT EXISTS "company_branches_company_id_parent_id_idx" ON "company_branches"("company_id", "parent_id");

CREATE TABLE IF NOT EXISTS "scim_provisioning_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "action" VARCHAR(50) NOT NULL,
  "external_id" VARCHAR(255),
  "user_id" UUID,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "scim_provisioning_events_company_id_created_at_idx" ON "scim_provisioning_events"("company_id", "created_at");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "branch_id" UUID REFERENCES "company_branches"("id") ON DELETE SET NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_provider" VARCHAR(20) NOT NULL DEFAULT 'local';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "external_id" VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS "users_company_id_external_id_key" ON "users"("company_id", "external_id") WHERE "external_id" IS NOT NULL;
