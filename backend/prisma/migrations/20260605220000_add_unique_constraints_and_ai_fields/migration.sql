-- Migration: Add unique constraints and new AI setting fields
-- Applies: @@unique([companyId, phone]) on leads,
--          @@unique([whatsappMessageId]) on messages,
--          @@index([leadId]) on conversations,
--          autoConfirmVisits + agentName fields on ai_settings

-- Step 1: Deduplicate existing leads before adding unique constraint.
-- Keep the EARLIEST lead per (company_id, phone) — oldest record is the canonical one.
DELETE FROM "leads" l1
USING "leads" l2
WHERE l1.company_id = l2.company_id
  AND l1.phone = l2.phone
  AND l1.created_at > l2.created_at;

-- Step 2: Deduplicate messages with duplicate whatsapp_message_id (keep earliest).
DELETE FROM "messages" m1
USING "messages" m2
WHERE m1.whatsapp_message_id = m2.whatsapp_message_id
  AND m1.whatsapp_message_id IS NOT NULL
  AND m1.created_at > m2.created_at;

-- Step 3: Add unique constraint on leads (company_id, phone).
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_phone_key" UNIQUE ("company_id", "phone");

-- Step 4: Replace the non-unique index on messages.whatsapp_message_id with a unique constraint.
DROP INDEX IF EXISTS "messages_whatsapp_message_id_idx";
-- The unique constraint also creates an implicit index, so no separate CREATE INDEX needed.
ALTER TABLE "messages" ADD CONSTRAINT "messages_whatsapp_message_id_key" UNIQUE ("whatsapp_message_id");

-- Step 5: Add missing index on conversations.lead_id for faster lead→conversation lookups.
CREATE INDEX IF NOT EXISTS "conversations_lead_id_idx" ON "conversations"("lead_id");

-- Step 6: Add autoConfirmVisits field to ai_settings (safe default: FALSE).
ALTER TABLE "ai_settings"
  ADD COLUMN IF NOT EXISTS "auto_confirm_visits" BOOLEAN NOT NULL DEFAULT false;

-- Step 7: Add agentName field to ai_settings.
ALTER TABLE "ai_settings"
  ADD COLUMN IF NOT EXISTS "agent_name" VARCHAR(50) NOT NULL DEFAULT 'Riya';
