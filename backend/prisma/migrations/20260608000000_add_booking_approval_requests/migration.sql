CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE "BookingApprovalKind" AS ENUM ('visit', 'call');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BookingApprovalStatus" AS ENUM ('pending', 'approved', 'declined', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_approval_requests_company_idempotency_uidx
  ON booking_approval_requests (company_id, idempotency_key);

CREATE INDEX IF NOT EXISTS booking_approval_requests_company_kind_status_scheduled_idx
  ON booking_approval_requests (company_id, kind, status, scheduled_at);

CREATE INDEX IF NOT EXISTS booking_approval_requests_company_agent_status_idx
  ON booking_approval_requests (company_id, agent_id, status);

CREATE INDEX IF NOT EXISTS booking_approval_requests_company_lead_kind_status_idx
  ON booking_approval_requests (company_id, lead_id, kind, status);

CREATE INDEX IF NOT EXISTS booking_approval_requests_expires_status_idx
  ON booking_approval_requests (expires_at, status);

