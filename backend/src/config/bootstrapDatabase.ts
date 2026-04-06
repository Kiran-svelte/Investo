import logger from './logger';
import prisma from './prisma';
import { seedDatabase } from './seed';

interface BootstrapOptions {
  autoMigrate: boolean;
  autoSeed: boolean;
}

async function applyCompatibilityPatches(): Promise<void> {
  // Ensure UUID helper exists.
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

  // users table compatibility (for Neon Auth migration + RBAC custom roles).
  await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider_id VARCHAR(255)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id UUID NULL`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS users_auth_provider_id_key ON users(auth_provider_id)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS users_custom_role_id_idx ON users(custom_role_id)`);

  // company_roles used by onboarding/user creation custom-role flow.
  await prisma.$executeRawUnsafe(`
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
  await prisma.$executeRawUnsafe(`
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
  await prisma.$executeRawUnsafe(`
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
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(255) UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens(user_id)`);
}

export async function bootstrapDatabase(options: BootstrapOptions): Promise<void> {
  const { autoMigrate, autoSeed } = options;

  if (!autoMigrate && !autoSeed) {
    return;
  }

  try {
    await applyCompatibilityPatches();
  } catch (err: any) {
    logger.error('Compatibility schema patch failed', { error: err.message });
    return;
  }

  // Check if core tables exist via Prisma (adapter-neon path) to avoid relying on
  // TCP-only migration clients in constrained environments.
  const tableCheck = await prisma.$queryRawUnsafe<Array<{ users_table: string | null }>>(
    `SELECT to_regclass('public.users')::text AS users_table`
  );
  const usersTable = tableCheck?.[0]?.users_table;

  if (!usersTable) {
    logger.error('Core schema missing (public.users not found). Run schema init against this database before using API flows.');
    return;
  }

  if (!autoSeed) {
    return;
  }

  let userCount = 0;
  try {
    userCount = await prisma.user.count();
  } catch (err: any) {
    logger.warn('User count check failed during bootstrap', { error: err.message });
    return;
  }

  if (userCount === 0) {
    logger.warn('No users found; running seed automatically');
    await seedDatabase();
  }
}
