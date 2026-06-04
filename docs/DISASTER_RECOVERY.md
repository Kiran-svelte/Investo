# Disaster recovery

## Database backups

### Managed provider (recommended)

- **Neon / Supabase**: enable automatic daily backups in the provider dashboard.
- Point-in-time recovery (PITR) when available on your plan.

### Manual backup script

```powershell
# Requires DATABASE_URL in environment (never commit)
.\scripts\backup-database.ps1
```

Creates `backups/investo-YYYYMMDD-HHmmss.sql` using `pg_dump`.

## Restore procedure

1. Create a new Postgres instance or maintenance window on existing.
2. `psql $DATABASE_URL -f backups/investo-YYYYMMDD-HHmmss.sql`
3. Run pending migrations: `cd backend && npx prisma migrate deploy`
4. Redeploy Render services (see `scripts/redeploy-production.ps1`).
5. Verify: `GET /api/health` and `GET /api/readiness`.

## Render / Vercel

- **Render**: service snapshots and env var export from dashboard.
- **Vercel**: redeploy prior deployment from Deployments tab.

## Secrets rotation

If keys are exposed: rotate `OPENAI_API_KEY`, `RENDER_API_KEY`, WhatsApp tokens, `JWT_SECRET`, and redeploy.

## RTO / RPO targets (operational)

| Metric | Target |
|--------|--------|
| RPO (data loss) | ≤ 24h with daily backups; ≤ 1h with PITR |
| RTO (service up) | ≤ 30 min with scripted redeploy |
