-- Chunk 05: PII encryption + secret rotation audit + IP allowlist on identity config

ALTER TABLE "company_identity_configs"
  ADD COLUMN IF NOT EXISTS "ip_allowlist_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ip_allowlist" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS "encrypted_fields" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "entity_type" VARCHAR(50) NOT NULL,
  "entity_id" UUID NOT NULL,
  "field_name" VARCHAR(100) NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "key_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "encrypted_fields_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "encrypted_fields_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "encrypted_fields_entity_type_entity_id_field_name_key"
  ON "encrypted_fields"("entity_type", "entity_id", "field_name");
CREATE INDEX IF NOT EXISTS "encrypted_fields_company_id_entity_type_idx"
  ON "encrypted_fields"("company_id", "entity_type");

CREATE TABLE IF NOT EXISTS "secret_rotation_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "secret_name" VARCHAR(100) NOT NULL,
  "rotated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rotated_by" VARCHAR(100) NOT NULL,
  CONSTRAINT "secret_rotation_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "secret_rotation_logs_secret_name_rotated_at_idx"
  ON "secret_rotation_logs"("secret_name", "rotated_at");
