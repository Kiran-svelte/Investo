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
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  await prisma.$executeRawUnsafe(`
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
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS property_knowledge_chunks_company_property_idx ON property_knowledge_chunks (company_id, property_id)`,
  );

  // Lead CRM metadata (8-pillar: lead_score, tags, source_detail, lost_reason).
  await prisma.$executeRawUnsafe(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);

  // users table compatibility (for Neon Auth migration + RBAC custom roles).
  await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider_id VARCHAR(255)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false`);
  await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_role_id UUID NULL`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS users_auth_provider_id_key ON users(auth_provider_id)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS users_custom_role_id_idx ON users(custom_role_id)`);
  // One active staff mobile per platform (deleted/inactive users do not block reuse).
  try {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_active_phone_unique
      ON users (phone)
      WHERE status = 'active' AND phone IS NOT NULL
    `);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      'users_active_phone_unique index not applied (resolve duplicate active phones, then restart)',
      { error: message },
    );
  }

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

  // Property import media blobs (DB-backed upload fallback).
  // Must be safe to run even when property_import_media does not exist yet.
  await prisma.$executeRawUnsafe(`
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

  await prisma.$executeRawUnsafe(`
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

  await prisma.$executeRawUnsafe(`
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
  await prisma.$executeRawUnsafe(`
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
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS agent_sessions_phone_idx ON agent_sessions(phone)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS agent_sessions_company_status_idx ON agent_sessions(company_id, status)`);
  await prisma.$executeRawUnsafe(`
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
  await prisma.$executeRawUnsafe(`
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
  await prisma.$executeRawUnsafe(`
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
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS property_projects_company_sort_idx ON property_projects (company_id, sort_order)`,
  );
  await prisma.$executeRawUnsafe(`
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
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS property_project_files_project_idx ON property_project_files (project_id)`,
  );
  await prisma.$executeRawUnsafe(`
    ALTER TABLE properties ADD COLUMN IF NOT EXISTS project_id UUID NULL REFERENCES property_projects(id) ON DELETE SET NULL
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE property_import_drafts ADD COLUMN IF NOT EXISTS project_id UUID NULL REFERENCES property_projects(id) ON DELETE SET NULL
  `);

  // Agent action log — AI transparency / audit trail (90-day TTL via cron purge).
  await prisma.$executeRawUnsafe(`
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
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS agent_action_logs_company_created_idx ON agent_action_logs (company_id, created_at)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS agent_action_logs_company_action_idx ON agent_action_logs (company_id, action)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS agent_action_logs_resource_idx ON agent_action_logs (resource_type, resource_id)`,
  );

  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  await prisma.$executeRawUnsafe(`
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
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS client_memory_chunks_company_lead_idx ON client_memory_chunks (company_id, lead_id)`,
  );
  await prisma.$executeRawUnsafe(`
    ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS last_lead_id UUID NULL REFERENCES leads(id) ON DELETE SET NULL
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS last_visit_id UUID NULL
  `);

  // Lead upsert requires @@unique([companyId, phone]) — safe on live DB.
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'leads_company_id_phone_key'
      ) THEN
        ALTER TABLE leads ADD CONSTRAINT leads_company_id_phone_key UNIQUE (company_id, phone);
      END IF;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS inbound_whatsapp_dedup (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      whatsapp_message_id VARCHAR(255) NOT NULL,
      sender_phone VARCHAR(32),
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT inbound_whatsapp_dedup_pkey PRIMARY KEY (id)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS inbound_whatsapp_dedup_company_id_whatsapp_message_id_key ON inbound_whatsapp_dedup (company_id, whatsapp_message_id)`,
  );

  // ai_settings columns required by Prisma AiSetting model (orchestrator H9 crashes without these).
  await prisma.$executeRawUnsafe(`
    ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS auto_confirm_visits BOOLEAN NOT NULL DEFAULT false
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS agent_name VARCHAR(50) NOT NULL DEFAULT 'Riya'
  `);

  // Workflow saga + centralized lead memory (A+ gate).
  await prisma.$executeRawUnsafe(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_memory JSONB`);
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "WorkflowRunStatus" AS ENUM (
        'running', 'completed', 'failed', 'completed_with_errors', 'needs_reconciliation'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS workflow_run_records (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      workflow_id VARCHAR(60) NOT NULL,
      channel VARCHAR(20) NOT NULL,
      idempotency_key VARCHAR(255),
      status "WorkflowRunStatus" NOT NULL DEFAULT 'running',
      state_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      steps_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      failed_step VARCHAR(80),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS workflow_idempotency_keys (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      key VARCHAR(255) NOT NULL,
      workflow_id VARCHAR(60) NOT NULL,
      result_reply TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'completed',
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS workflow_idempotency_keys_company_key_uidx ON workflow_idempotency_keys (company_id, key)`,
  );

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS pending_actions_session_status_idx ON pending_actions(session_id, status)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS pending_actions_expires_idx ON pending_actions(expires_at)`);

  // call_requests — WhatsApp call booking workflow.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS call_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scheduled_at TIMESTAMP NOT NULL,
      duration_minutes INT NOT NULL DEFAULT 15,
      status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
      notes TEXT NULL,
      agent_confirmed_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS call_requests_company_lead_idx ON call_requests (company_id, lead_id, scheduled_at DESC)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS call_requests_agent_scheduled_idx ON call_requests (agent_id, scheduled_at)`,
  );

  // booking_approval_requests — source of truth for buyer-initiated visit/call approvals.
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "BookingApprovalKind" AS ENUM ('visit', 'call');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "BookingApprovalStatus" AS ENUM ('pending', 'approved', 'declined', 'cancelled', 'expired');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS booking_approval_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      kind "BookingApprovalKind" NOT NULL,
      status "BookingApprovalStatus" NOT NULL DEFAULT 'pending',
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      property_id UUID NULL REFERENCES properties(id) ON DELETE SET NULL,
      call_request_id UUID NULL,
      scheduled_at TIMESTAMPTZ NOT NULL,
      customer_phone VARCHAR(20) NOT NULL,
      customer_name VARCHAR(255) NULL,
      conversation_id UUID NULL REFERENCES conversations(id) ON DELETE SET NULL,
      idempotency_key VARCHAR(255) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      resolved_at TIMESTAMPTZ NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS booking_approval_requests_company_idempotency_uidx ON booking_approval_requests (company_id, idempotency_key)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS booking_approval_requests_company_kind_status_scheduled_idx ON booking_approval_requests (company_id, kind, status, scheduled_at)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS booking_approval_requests_company_agent_status_idx ON booking_approval_requests (company_id, agent_id, status)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS booking_approval_requests_company_lead_kind_status_idx ON booking_approval_requests (company_id, lead_id, kind, status)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS booking_approval_requests_expires_status_idx ON booking_approval_requests (expires_at, status)`,
  );
  await prisma.$executeRawUnsafe(`
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

export async function bootstrapDatabase(options: BootstrapOptions): Promise<void> {
  const { autoMigrate, autoSeed } = options;

  try {
    await applyCompatibilityPatches();
  } catch (err: any) {
    logger.error('Compatibility schema patch failed', { error: err.message });
    return;
  }

  if (!autoMigrate && !autoSeed) {
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
