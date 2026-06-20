-- Chunk 05: store encrypted OIDC client secret per company
ALTER TABLE "company_identity_configs"
  ADD COLUMN IF NOT EXISTS "sso_oidc_client_secret_enc" TEXT;
