# Investo Backend — Operations Runbook

## Health endpoints

| Endpoint | Use |
|----------|-----|
| `GET /api/health/live` | Liveness — process up (load balancer ping) |
| `GET /api/health/ready` | Readiness — DB + Redis (returns 503 if not ready) |
| `GET /api/health` | Deep check — OpenAI, mail, storage, `ops_metrics` |

## DB unreachable

1. Check Render Postgres / Neon dashboard for instance status.
2. Verify `DATABASE_URL` in Render env (pooler port 6543 for Supabase).
3. Hit `/api/health/ready` — `checks.db.status` should be `ok`.
4. If migrations pending: redeploy with `AUTO_MIGRATE=true` or run `npx prisma migrate deploy` via Render shell.

## AI provider down

1. `/api/health` → `dependencies.openai.status`.
2. If `invalid_key` or `insufficient_quota`: rotate/fix `OPENAI_API_KEY` in Render, redeploy.
3. Circuit breaker opens after repeated failures — wait 30s or restart service.
4. WhatsApp still serves deterministic CRM paths when LLM is down.

## WhatsApp webhook failing

1. Confirm Meta/GreenAPI webhook URL points to `https://<backend>/api/webhook` or `/api/greenapi/webhook`.
2. Check `WHATSAPP_VERIFY_TOKEN` matches provider console.
3. Review logs for `webhook_inbound` and 429s — tune `RATE_LIMIT_WEBHOOK` / `RATE_LIMIT_WHATSAPP_AI`.
4. GreenAPI: verify instance authorized and `phoneNumberId` in company settings.

## Rate limit storm

1. Identify 429 spikes in `ops_metrics.counters.rate_limited`.
2. `Retry-After` header is set on all 429 responses.
3. Raise limits via env: `RATE_LIMIT_USER`, `RATE_LIMIT_COMPANY`, `RATE_LIMIT_WHATSAPP_AI`.
4. Check for runaway automation or replay attacks on webhook IP.

## Memory / OOM

1. Render metrics → memory; scale instance type if sustained high.
2. Property import worker and automation queue can spike heap — pause imports.
3. Graceful restart: send SIGTERM (Render deploy does this); drain completes within 30s.

## Graceful rollback

1. Render Dashboard → service → Deploys → select last **live** deploy → Rollback.
2. Or redeploy previous git SHA: `scripts/redeploy-production.ps1`.
3. Verify `/api/health` shows expected `production_polish` / `ai_capabilities` after rollback.

## Graceful shutdown (manual)

```bash
kill -SIGTERM <pid>
```

Expect logs: `graceful shutdown initiated` → `HTTP server closed` → `Database connection pool closed` → exit within 30s.
