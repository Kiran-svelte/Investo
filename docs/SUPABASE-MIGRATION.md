# Supabase database migration (Investo)

## Status: complete (local + Supabase data)

Neon production data was copied to Supabase project `klmpifgkxzlignvwaohv` (Mumbai / `aws-1-ap-south-1`).

Verified counts on Supabase:

- 29 users
- 171 leads
- 2,007 messages
- 11 companies

## Connection strings

Use the pooler host from your dashboard. This project uses **`aws-1-ap-south-1.pooler.supabase.com`** (not `aws-0-us-east-1`).

| Use | Port | User format |
|-----|------|-------------|
| App runtime (`DATABASE_URL`) | 6543 | `postgres.klmpifgkxzlignvwaohv` |
| Migrations / session (`DIRECT_URL`) | 5432 | `postgres.klmpifgkxzlignvwaohv` |

Local config: `backend/.env` (already updated).

## Code changes

- Prisma uses `@prisma/adapter-pg` (Supabase pooler), not Neon adapter.
- Knex migrations use `DIRECT_URL` with SSL for schema changes.
- `NEON_KEEPALIVE_ENABLED` defaults to `false` when on Supabase.

## Production (Render)

Update **investo-backend-v2** (`srv-d79itik50q8c73fjqi7g`) (and **investo-frontend-v2** on Render if it shares env):

1. Set `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_PROJECT_REF` (copy from `backend/.env`).
2. Set `NEON_KEEPALIVE_ENABLED=false`.
3. Redeploy both services.

Helper (requires Render API key with access to Investo workspace):

```bash
cd backend
node scripts/update-render-supabase-env.mjs
```

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/export-neon-schema.mjs` | Export Neon tables to `tmp/neon-export/` |
| `scripts/import-neon-export-to-supabase.mjs` | Import JSON export into Supabase |
| `scripts/supabase-status.mjs` | List public tables + user count |
| `backend/scripts/test-db.ts` | Quick Prisma count check |
| `backend/scripts/update-render-supabase-env.mjs` | Patch Render env + deploy |

## Supabase MCP

`.cursor/mcp.json` includes the Supabase MCP URL. Reload Cursor and complete OAuth once to enable `execute_sql`, `apply_migration`, etc.

## Notes

- **Neon** remains as a backup until you decommission it.
- **Neon Auth** (`NEON_AUTH_URL`) is unchanged; only Postgres moved.
- Rotate the Supabase DB password if it was shared in chat.
