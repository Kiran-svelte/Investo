-- Migration: add_missing_indexes_perf
-- Adds 10 performance-critical indexes identified by production audit.
-- Uses IF NOT EXISTS to be safe to re-run without failing if already present.
-- NOTE: CONCURRENTLY removed — Prisma db execute runs in a transaction block.
-- For zero-downtime production deployments, run each statement individually
-- via psql outside a transaction.
-- Timestamp: 2026-06-05

CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_resource_id_idx" ON "audit_logs"("resource_id");
CREATE INDEX IF NOT EXISTS "conversations_company_id_status_idx" ON "conversations"("company_id", "status");
CREATE INDEX IF NOT EXISTS "conversations_lead_id_idx" ON "conversations"("lead_id");
CREATE INDEX IF NOT EXISTS "leads_company_id_last_contact_at_idx" ON "leads"("company_id", "last_contact_at");
CREATE INDEX IF NOT EXISTS "notifications_company_id_idx" ON "notifications"("company_id");
CREATE INDEX IF NOT EXISTS "properties_company_id_project_id_idx" ON "properties"("company_id", "project_id");
CREATE INDEX IF NOT EXISTS "property_project_files_company_id_idx" ON "property_project_files"("company_id");
CREATE INDEX IF NOT EXISTS "visits_company_id_status_scheduled_at_idx" ON "visits"("company_id", "status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "visits_lead_id_idx" ON "visits"("lead_id");
