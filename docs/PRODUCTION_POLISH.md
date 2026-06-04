# Production polish — 10 pillars

Investo backend + frontend production readiness checklist. Verify after each deploy:

```powershell
(Invoke-RestMethod https://investo-backend-v2.onrender.com/api/health).production_polish
```

## 1. Error handling and resilience

| Item | Location |
|------|----------|
| Global 500 handler (no stack leak) | `backend/src/app.ts` |
| `withRetry` exponential backoff | `backend/src/utils/retry.ts` |
| OpenAI retry / quota classification | `backend/src/services/openaiStatus.service.ts` |
| Queue retries (import, automation) | `propertyImportQueue`, `automationQueue` |
| WhatsApp send retry on AI reply | `whatsapp.service.ts` |
| Copilot fallback messages | `agent-router.service.ts` |

## 2. Logging and monitoring

| Item | Location |
|------|----------|
| Structured HTTP logs + `X-Request-Id` | `backend/src/middleware/requestLogger.ts` |
| Ops counters (webhook, AI, errors) | `backend/src/services/opsMetrics.service.ts` |
| Super-admin metrics API | `GET /api/admin/ops-metrics` |
| Health + readiness | `/api/health`, `/api/readiness` |
| Error log UI | `frontend/src/pages/error-logs/` |

## 3. Security and compliance

| Item | Location |
|------|----------|
| Helmet, CORS allowlist | `backend/src/app.ts` |
| Rate limits (user, company, AI, webhook, export) | `backend/src/middleware/rateLimiter.ts` |
| Redis-backed company limits when Upstash configured | `cacheIncr` in `redis.ts` |
| Log / settings redaction | `backend/src/utils/sanitize.ts` |
| Privacy + tenant isolation | `docs/SECURITY.md` |

## 4. Performance and scaling

| Item | Location |
|------|----------|
| Upstash Redis cache + counters | `backend/src/config/redis.ts` |
| Analytics dashboard 60s cache | `analytics.routes.ts` |
| Property import worker (Render) | `worker.ts`, `render.yaml` |
| Automation queue | `automationQueue.service.ts` |

## 5. User experience polish

| Item | Location |
|------|----------|
| Outbound message polish + branding footer | `messagePolish.service.ts` |
| Typing indicator + read receipt (Meta) | `whatsappPresence.service.ts` |
| Human reply delay before AI text | `simulateHumanReplyPacing` |
| Quick-reply buttons after AI | `sendContextualQuickReplies` |
| Staff CRM shortcut buttons | `agent-router.service.ts` |

## 6. Analytics and reporting (agency owners)

| Item | Location |
|------|----------|
| Dashboard API | `GET /api/analytics/dashboard` |
| Analytics page | `frontend/src/pages/analytics/AnalyticsPage.tsx` |
| Agent copilot analytics tools | `agent/tools/analytics-tools.ts` |
| Ops counters for platform owners | `/api/admin/ops-metrics` |

## 7. Testing and QA

```powershell
cd backend
npm test -- --testPathPattern="retry|whatsappPresence|production-polish|workflow-scenario|security"
cd ../frontend
npm test
npm run test:e2e   # optional, needs env
.\scripts\prove-full-ai-stack.ps1
```

## 8. Backup and disaster recovery

See [DISASTER_RECOVERY.md](./DISASTER_RECOVERY.md) and `scripts/backup-database.ps1`.

## 9. Documentation

| Doc | Purpose |
|-----|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System map |
| [WORKFLOW_ENGINE.md](./WORKFLOW_ENGINE.md) | 15 workflows |
| [WHATSAPP_AI_PROOF.md](./WHATSAPP_AI_PROOF.md) | Live proof steps |
| [SECURITY.md](./SECURITY.md) | Security controls |

## 10. Branding and polish

- WhatsApp messages use `*bold*` formatting via polish layer.
- Company name footer: `— *{Company}* via Investo` when not already in body.
- Staff copilot header: `Investo Copilot` on shortcut buttons.
