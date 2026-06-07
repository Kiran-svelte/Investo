-- Add 'pending' to MessageStatus enum
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'pending' BEFORE 'sent';

-- Add call notification types to NotificationType enum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'call_requested';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'call_scheduled';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'call_completed';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'call_cancelled';

-- call_requests table (migrated from bootstrapDatabase runtime patch)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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
);

CREATE INDEX IF NOT EXISTS call_requests_company_lead_idx ON call_requests (company_id, lead_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS call_requests_agent_scheduled_idx ON call_requests (agent_id, scheduled_at);

