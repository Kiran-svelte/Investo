# Staging Parity Checklist

Chunk 01 adds a key-only parity check so staging can be compared with production without exposing secret values.

## Required Environments

Staging must have the same required keys as production for:

- Database connectivity: `DATABASE_URL`, `DIRECT_URL`
- Auth and sessions: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `NEON_AUTH_URL`
- Redis and queues: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RUN_BACKGROUND_WORKERS_ON_API`
- WhatsApp: `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, tenant-level Meta credentials in company settings
- AI: `OPENAI_API_KEY`, provider/model keys used by production
- Storage: active `STORAGE_PROVIDER` keys and bucket configuration
- Frontend/API origins: `FRONTEND_BASE_URL`, `CORS_ORIGINS`
- SLO overrides: `SLO_API_P95_MS`, `SLO_WEBHOOK_ACK_P95_MS`, `SLO_RTO_MINUTES`, `SLO_RPO_MINUTES`

## Local Proof

Export redacted key files from the hosting provider, then compare keys only:

```bash
cd backend
node scripts/staging-env-diff.mjs staging.env.keys prod.env.keys
```

The script prints JSON and exits non-zero when production keys are missing in staging.

## Release Rule

Chunk gates that depend on queues, Redis, webhooks, AI, storage, or SSO must run in staging only after this parity check passes.
