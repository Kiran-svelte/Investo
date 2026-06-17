# Disaster Recovery Runbook

Last updated: 2026-06-17  
Owner: Platform Ops  
Related: `main_docs/chunks/chunk-08.md`, `docs/enterprise/INCIDENT_RUNBOOK.md`

## Recovery objectives

| Tier | RTO | RPO | Scope |
|------|-----|-----|-------|
| Tier 1 | 15 min | 5 min | PostgreSQL (leads, messages) |
| Tier 2 | 1 hour | 15 min | Redis queues (replay from DLQ/DB) |
| Tier 3 | 4 hours | 1 hour | S3 media, pgvector re-index |
| Tier 4 | 24 hours | N/A | Analytics warehouse |

## Preconditions

- Supabase PITR enabled on production project
- `BACKUP_LAST_SUCCESS_AT` env var updated after each verified backup
- Grafana + status page wired (chunk 07)
- WhatsApp DLQ available for replay (chunk 02)

## Failover workflow

1. **Detect** — health checks fail >5 min OR manual incident declaration
2. **Communicate** — update status page; notify on-call (`docs/enterprise/ON_CALL.md`)
3. **Enable read-only** — set `FEATURE_READ_ONLY_MODE=true` on API + worker
4. **Restore database**
   - Identify PITR timestamp (RPO target ≤15 min)
   - Restore to staging first for validation when time permits
   - Update `DATABASE_URL` / `DIRECT_URL` in Render/Railway
5. **Restart services** — API + dedicated worker
6. **Post-restore**
   - Run property knowledge re-index if pgvector affected
   - Replay WhatsApp dead-letter queue
   - Verify `/api/health/enterprise` shows acceptable `backup_age_hours`
7. **Disable read-only** — set `FEATURE_READ_ONLY_MODE=false`
8. **Record drill** — log results in incident tracker; update `BACKUP_LAST_SUCCESS_AT`

## Read-only mode

When `FEATURE_READ_ONLY_MODE=true`:

- All mutating HTTP methods return `503` with `{ error: "read_only_mode" }`
- Allowed: health, readiness, metrics, status, auth, inbound webhooks
- Buyer WhatsApp inbound continues to queue; outbound paused until restore completes

## Verification checklist

- [ ] `/api/health/enterprise` returns `read_only_mode` and `backup_age_hours`
- [ ] Login works; lead create blocked during read-only
- [ ] Worker processes queued inbound after restore
- [ ] SLO dashboards green within 30 minutes

## Quarterly restore drill

1. Take latest logical backup
2. Restore to staging Supabase project
3. Point staging API at restored DB
4. Run smoke + synthetic monitor
5. Record actual RTO/RPO in postmortem

## Environment variables

| Variable | Purpose |
|----------|---------|
| `FEATURE_READ_ONLY_MODE` | Block writes during DR |
| `READ_ONLY_MODE_REASON` | Banner/message text |
| `BACKUP_LAST_SUCCESS_AT` | ISO timestamp for backup age metric |
| `DR_PRIMARY_REGION` | Region label in health output |
