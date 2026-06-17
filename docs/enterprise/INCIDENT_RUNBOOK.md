# Investo — Incident Runbook

| Field | Value |
|-------|-------|
| Version | chunk-07 |
| Audience | On-call engineers, platform ops |
| Related | [ON_CALL.md](./ON_CALL.md), [STAGING_PARITY.md](./STAGING_PARITY.md) |

---

## Severity definitions

| Severity | Definition | Target ack | Target mitigate |
|----------|------------|------------|-----------------|
| **P1** | Platform down, all WhatsApp inbound/outbound failing, or data loss risk | 15 min | 60 min |
| **P2** | Single tenant degraded, partial feature outage, SLO burn >2× | 60 min | 4 hr |
| **P3** | Non-critical bug, cosmetic issue, single-user report | Next business day | As scheduled |

---

## P1 — Platform down

### 1. Acknowledge

1. Ack PagerDuty / `#incidents` within **15 minutes**.
2. Assign **Incident Commander (IC)** and **Communications lead**.

### 2. Triage (first 10 minutes)

```bash
# Live probe
curl -sS https://investo-backend-production.up.railway.app/api/health/live

# Full health + SLO block
curl -sS https://investo-backend-production.up.railway.app/api/health | jq '.slo, .dependencies'

# Synthetic suite
cd backend && npm run synthetic
```

Check:

- `/api/health` → `dependencies.db`, `dependencies.platform.redis_ok`
- `/api/metrics` → error rate, queue depth, circuit breaker
- Sentry → spike in 5xx or WhatsApp errors
- Railway/Render → recent deploy, OOM, crash loop

### 3. Communicate

1. Update public status page (`STATUS_PAGE_URL` / Instatus / Better Stack).
2. Post internal summary: impact, start time, current hypothesis.

### 4. Mitigate

| Symptom | Likely cause | Mitigation |
|---------|--------------|------------|
| DB down | Supabase/Neon outage | Failover per DR runbook (chunk 08); enable read-only if available |
| Redis down | Upstash outage | Degraded mode (in-memory); reduce load; disable async pipeline if needed |
| Meta circuit open | Meta API 5xx | Wait for half-open; pause bulk outbound |
| Worker stuck | Queue backlog | Scale worker; replay DLQ after root fix |
| Bad deploy | Recent release | Roll back Railway/Render to last green commit |

Kill switches (env, no redeploy if already in config cache):

```
FEATURE_ASYNC_WHATSAPP_PIPELINE=false
FEATURE_TENANT_QUOTAS=false
```

### 5. Resolve & postmortem

1. Confirm `/api/health/live` + `npm run smoke` green.
2. Resolve status page incident.
3. Blameless postmortem within **48 hours** — template below.

---

## P2 — Tenant or partial degradation

1. Identify `company_id` from audit logs / Sentry tags.
2. Check tenant quota 429s: `GET /api/quota/usage` (as company_admin) or super-admin override.
3. Check WhatsApp DLQ: super-admin → Message Failures page.
4. Escalate to P1 if multi-tenant impact.

---

## Incident doc template

```
# Incident YYYY-MM-DD — [title]

- Severity: P1/P2/P3
- Start (UTC):
- End (UTC):
- Impact:
- Root cause:
- Timeline:
- What went well:
- What went wrong:
- Action items: (GitHub issue links)
```

---

## Useful commands

```bash
cd backend
npm run smoke
npm run synthetic
npm run baseline
npx jest src/tests/integration/tenantIsolation.matrix.test.ts --runInBand
```

Super-admin UI:

- Platform Health → `/dashboard/platform-health`
- Observability → `/dashboard/observability`
- Message Failures (DLQ) → `/dashboard/message-failures`
