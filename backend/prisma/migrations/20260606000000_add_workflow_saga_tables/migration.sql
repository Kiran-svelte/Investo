-- Migration: add_workflow_saga_tables
-- Adds workflow_run_records (saga tracking) and workflow_idempotency_keys (intent dedup)
-- and lead_memory JSON column on leads (centralized AI memory blob).
-- Migration is backward-compatible: all new columns/tables are additive.
-- Safe to run against a live application (no DROP or ALTER of existing columns).

-- ─── 1. Lead memory blob ─────────────────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_memory JSONB;

-- ─── 2. Workflow run status enum ─────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "WorkflowRunStatus" AS ENUM (
    'running',
    'completed',
    'failed',
    'completed_with_errors',
    'needs_reconciliation'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3. Workflow run records (saga) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_run_records (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workflow_id      VARCHAR(60) NOT NULL,
  channel          VARCHAR(20) NOT NULL,
  idempotency_key  VARCHAR(255),
  status           "WorkflowRunStatus" NOT NULL DEFAULT 'running',
  state_snapshot   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  steps_json       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  failed_step      VARCHAR(80),
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_run_records_company_status_idx
  ON workflow_run_records (company_id, status);

CREATE INDEX IF NOT EXISTS workflow_run_records_company_workflow_idx
  ON workflow_run_records (company_id, workflow_id, created_at);

CREATE INDEX IF NOT EXISTS workflow_run_records_idem_key_idx
  ON workflow_run_records (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── 4. Workflow idempotency keys ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_idempotency_keys (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key          VARCHAR(255) NOT NULL,
  workflow_id  VARCHAR(60) NOT NULL,
  result_reply TEXT,
  status       VARCHAR(20) NOT NULL DEFAULT 'completed',
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_idempotency_keys_company_key_uidx
  ON workflow_idempotency_keys (company_id, key);

CREATE INDEX IF NOT EXISTS workflow_idempotency_keys_company_expires_idx
  ON workflow_idempotency_keys (company_id, expires_at);
