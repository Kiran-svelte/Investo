"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrapDatabase = bootstrapDatabase;
const logger_1 = __importDefault(require("./logger"));
const prisma_1 = __importDefault(require("./prisma"));
const seed_1 = require("./seed");
async function applyCompatibilityPatches() {
    // Ensure UUID helper exists.
    await prisma_1.default.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    // users table compatibility (for Neon Auth migration + RBAC custom roles).
    await prisma_1.default.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider_id VARCHAR(255)`);
    await prisma_1.default.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`);
    await prisma_1.default.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id UUID NULL`);
    await prisma_1.default.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS users_auth_provider_id_key ON users(auth_provider_id)`);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS users_custom_role_id_idx ON users(custom_role_id)`);
    // company_roles used by onboarding/user creation custom-role flow.
    await prisma_1.default.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS company_roles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      role_name VARCHAR(80) NOT NULL,
      display_name VARCHAR(120) NOT NULL,
      permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now(),
      UNIQUE (company_id, role_name)
    )
  `);
    // company_features used by feature gating and onboarding step 3.
    await prisma_1.default.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS company_features (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      feature_key VARCHAR(100) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now(),
      UNIQUE (company_id, feature_key)
    )
  `);
    // onboarding state table used by onboarding flow.
    await prisma_1.default.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS company_onboarding (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID UNIQUE NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      step_completed INTEGER NOT NULL DEFAULT 0,
      company_profile BOOLEAN NOT NULL DEFAULT false,
      roles_configured BOOLEAN NOT NULL DEFAULT false,
      features_selected BOOLEAN NOT NULL DEFAULT false,
      ai_configured BOOLEAN NOT NULL DEFAULT false,
      team_invited BOOLEAN NOT NULL DEFAULT false,
      completed_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
    // Password reset flow support.
    await prisma_1.default.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(255) UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens(user_id)`);
    // Property import media blobs (DB-backed upload fallback).
    // Must be safe to run even when property_import_media does not exist yet.
    await prisma_1.default.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF to_regclass('public.property_import_media') IS NOT NULL THEN
        EXECUTE '
          CREATE TABLE IF NOT EXISTS property_import_media_blobs (
            media_id UUID PRIMARY KEY REFERENCES property_import_media(id) ON DELETE CASCADE,
            company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            mime_type VARCHAR(120) NOT NULL,
            file_size INTEGER NOT NULL,
            bytes BYTEA NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP NOT NULL DEFAULT now()
          )
        ';

        EXECUTE 'CREATE INDEX IF NOT EXISTS property_import_media_blobs_company_id_idx ON property_import_media_blobs(company_id)';
      END IF;
    END $$;
  `);
}
async function bootstrapDatabase(options) {
    const { autoMigrate, autoSeed } = options;
    try {
        await applyCompatibilityPatches();
    }
    catch (err) {
        logger_1.default.error('Compatibility schema patch failed', { error: err.message });
        return;
    }
    if (!autoMigrate && !autoSeed) {
        return;
    }
    // Check if core tables exist via Prisma (adapter-neon path) to avoid relying on
    // TCP-only migration clients in constrained environments.
    const tableCheck = await prisma_1.default.$queryRawUnsafe(`SELECT to_regclass('public.users')::text AS users_table`);
    const usersTable = tableCheck?.[0]?.users_table;
    if (!usersTable) {
        logger_1.default.error('Core schema missing (public.users not found). Run schema init against this database before using API flows.');
        return;
    }
    if (!autoSeed) {
        return;
    }
    let userCount = 0;
    try {
        userCount = await prisma_1.default.user.count();
    }
    catch (err) {
        logger_1.default.warn('User count check failed during bootstrap', { error: err.message });
        return;
    }
    if (userCount === 0) {
        logger_1.default.warn('No users found; running seed automatically');
        await (0, seed_1.seedDatabase)();
    }
}
//# sourceMappingURL=bootstrapDatabase.js.map