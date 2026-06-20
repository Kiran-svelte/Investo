-- Chunk 06: Analytics performance — add missing compound indexes
-- Lead: companyId + createdAt for 'leads today' dashboard KPI query.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_company_id_created_at_idx"
  ON "leads" ("company_id", "created_at");

-- Visit: companyId + status + scheduledAt for 'upcoming / completed visits' KPI queries.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "visits_company_id_status_scheduled_at_idx"
  ON "visits" ("company_id", "status", "scheduled_at");
