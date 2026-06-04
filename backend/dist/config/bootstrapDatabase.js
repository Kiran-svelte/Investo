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
    await prisma_1.default.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
    await prisma_1.default.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS property_knowledge_chunks (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      source_type VARCHAR(40) NOT NULL,
      content TEXT NOT NULL,
      embedding vector(1536),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS property_knowledge_chunks_company_property_idx ON property_knowledge_chunks (company_id, property_id)`);
    // Lead CRM metadata (8-pillar: lead_score, tags, source_detail, lost_reason).
    await prisma_1.default.$executeRawUnsafe(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
    // users table compatibility (for Neon Auth migration + RBAC custom roles).
    await prisma_1.default.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider_id VARCHAR(255)`);
    await prisma_1.default.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`);
    await prisma_1.default.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id UUID NULL`);
    await prisma_1.default.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS users_auth_provider_id_key ON users(auth_provider_id)`);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS users_custom_role_id_idx ON users(custom_role_id)`);
    // One active staff mobile per platform (deleted/inactive users do not block reuse).
    try {
        await prisma_1.default.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_active_phone_unique
      ON users (phone)
      WHERE status = 'active' AND phone IS NOT NULL
    `);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger_1.default.warn('users_active_phone_unique index not applied (resolve duplicate active phones, then restart)', { error: message });
    }
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
      IF to_regclass('public.property_import_drafts') IS NOT NULL THEN
        EXECUTE '
          CREATE TABLE IF NOT EXISTS property_import_units (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            draft_id UUID NOT NULL REFERENCES property_import_drafts(id) ON DELETE CASCADE,
            company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            label VARCHAR(255),
            unit_data JSONB NOT NULL DEFAULT ''{}''::jsonb,
            published_property_id UUID REFERENCES properties(id),
            status VARCHAR(20) NOT NULL DEFAULT ''draft'',
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP NOT NULL DEFAULT now()
          )
        ';
        EXECUTE 'CREATE INDEX IF NOT EXISTS property_import_units_draft_sort_idx ON property_import_units(draft_id, sort_order)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS property_import_units_company_id_idx ON property_import_units(company_id)';
      END IF;
    END $$;
  `);
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
    await prisma_1.default.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentSessionStatus') THEN
        CREATE TYPE "AgentSessionStatus" AS ENUM ('active', 'inactive');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PendingActionStatus') THEN
        CREATE TYPE "PendingActionStatus" AS ENUM ('awaiting', 'confirmed', 'rejected', 'expired');
      END IF;
    END $$;
  `);
    // Agent AI sessions for WhatsApp-first internal-user workflows.
    await prisma_1.default.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      phone VARCHAR(20) NOT NULL,
      thread_id VARCHAR(100) NOT NULL UNIQUE,
      status "AgentSessionStatus" NOT NULL DEFAULT 'active',
      last_active_at TIMESTAMP NOT NULL DEFAULT now(),
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now(),
      UNIQUE (user_id, phone)
    )
  `);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS agent_sessions_phone_idx ON agent_sessions(phone)`);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS agent_sessions_company_status_idx ON agent_sessions(company_id, status)`);
    await prisma_1.default.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'agent_sessions'
          AND column_name = 'status'
          AND udt_name <> 'AgentSessionStatus'
      ) THEN
        ALTER TABLE agent_sessions ALTER COLUMN status DROP DEFAULT;
        ALTER TABLE agent_sessions
          ALTER COLUMN status TYPE "AgentSessionStatus"
          USING status::text::"AgentSessionStatus";
        ALTER TABLE agent_sessions ALTER COLUMN status SET DEFAULT 'active'::"AgentSessionStatus";
      END IF;
    END $$;
  `);
    // Pending confirmations for destructive agent actions.
    await prisma_1.default.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS pending_actions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      action_type VARCHAR(100) NOT NULL,
      action_params JSONB NOT NULL DEFAULT '{}'::jsonb,
      display_message TEXT NOT NULL,
      status "PendingActionStatus" NOT NULL DEFAULT 'awaiting',
      expires_at TIMESTAMP NOT NULL,
      resolved_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
    // Property projects — group listings and imports per site/development.
    await prisma_1.default.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS property_projects (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS property_projects_company_sort_idx ON property_projects (company_id, sort_order)`);
    await prisma_1.default.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS property_project_files (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      project_id UUID NOT NULL REFERENCES property_projects(id) ON DELETE CASCADE,
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NULL,
      storage_key VARCHAR(500) NOT NULL,
      file_size INTEGER NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS property_project_files_project_idx ON property_project_files (project_id)`);
    await prisma_1.default.$executeRawUnsafe(`
    ALTER TABLE properties ADD COLUMN IF NOT EXISTS project_id UUID NULL REFERENCES property_projects(id) ON DELETE SET NULL
  `);
    await prisma_1.default.$executeRawUnsafe(`
    ALTER TABLE property_import_drafts ADD COLUMN IF NOT EXISTS project_id UUID NULL REFERENCES property_projects(id) ON DELETE SET NULL
  `);
    // Agent action log — AI transparency / audit trail (90-day TTL via cron purge).
    await prisma_1.default.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS agent_action_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      triggered_by VARCHAR(40) NOT NULL,
      actor_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
      actor_role VARCHAR(40) NULL,
      action VARCHAR(100) NOT NULL,
      resource_type VARCHAR(40) NULL,
      resource_id UUID NULL,
      inputs JSONB DEFAULT '{}'::jsonb,
      result TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'success',
      error_message TEXT NULL,
      duration_ms INTEGER NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS agent_action_logs_company_created_idx ON agent_action_logs (company_id, created_at)`);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS agent_action_logs_company_action_idx ON agent_action_logs (company_id, action)`);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS agent_action_logs_resource_idx ON agent_action_logs (resource_type, resource_id)`);
    await prisma_1.default.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
    await prisma_1.default.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS client_memory_chunks (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      source_type VARCHAR(40) NOT NULL,
      source_id VARCHAR(100) NULL,
      content TEXT NOT NULL,
      embedding vector(1536),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS client_memory_chunks_company_lead_idx ON client_memory_chunks (company_id, lead_id)`);
    await prisma_1.default.$executeRawUnsafe(`
    ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS last_lead_id UUID NULL REFERENCES leads(id) ON DELETE SET NULL
  `);
    await prisma_1.default.$executeRawUnsafe(`
    ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS last_visit_id UUID NULL
  `);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS pending_actions_session_status_idx ON pending_actions(session_id, status)`);
    await prisma_1.default.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS pending_actions_expires_idx ON pending_actions(expires_at)`);
    await prisma_1.default.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'pending_actions'
          AND column_name = 'status'
          AND udt_name <> 'PendingActionStatus'
      ) THEN
        ALTER TABLE pending_actions ALTER COLUMN status DROP DEFAULT;
        ALTER TABLE pending_actions
          ALTER COLUMN status TYPE "PendingActionStatus"
          USING status::text::"PendingActionStatus";
        ALTER TABLE pending_actions ALTER COLUMN status SET DEFAULT 'awaiting'::"PendingActionStatus";
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
