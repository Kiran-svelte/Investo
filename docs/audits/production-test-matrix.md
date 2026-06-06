# Investo Production Test Matrix

Updated: 2026-06-06

This is the proof map for selling Investo to companies. Do not mark a category as production-ready unless it has evidence from the listed gate. Some checks are automated; others require staging, production, security, or real-user evidence.

## How to Run the Gate

Local automated proof:

```powershell
.\scripts\run-full-a-plus-gate.ps1
```

Dedicated AI/product evals only:

```powershell
.\scripts\run-investo-evals.ps1
```

Full production proof, when credentials and safe test phones are available:

```powershell
$env:RAILWAY_ACCOUNT_TOKEN = '<token>'
$env:E2E_EMAIL = 'admin@investo.in'
$env:E2E_PASSWORD = '<password>'
.\scripts\run-full-a-plus-gate.ps1 -RunE2E -RunProduction -RunHandset -RunChaos
```

## Coverage Matrix

| Category | Investo proof gate | Status |
|---|---|---|
| Product eval harness | `backend/src/evals/*`, `backend: npm run eval` | Automated |
| Unit tests | `backend: npx jest --runInBand`, `frontend: npm test` | Automated |
| Integration tests | Backend route/service Jest suites, webhook route suites, conversation/visit/auth route tests | Automated |
| Component tests | Frontend Vitest suite | Automated |
| E2E tests | `frontend: npm run test:e2e` through `-RunE2E` | Optional automated, needs credentials |
| Contract tests | `npx tsc --noEmit`, DTO/route contract suites, Meta message builder/parser suites | Automated |
| Regression tests | Full backend Jest, frontend Vitest, Playwright core routes | Automated plus optional E2E |
| Smoke tests | Backend/frontend builds, health route tests, production workflow smoke through `-RunProduction` | Automated/local plus optional prod |
| Load/performance | `scripts/load-health-smoke.mjs` and `load-health.perf.test.ts` | Automated lightweight |
| Stress | Not fully covered; needs k6/Artillery or cloud load test against staging | Manual/external |
| Soak/endurance | Not covered by local gate; needs multi-hour staging run | Manual/external |
| Spike | Not covered by local gate; needs staged burst test | Manual/external |
| Scalability | Partly covered by load smoke; real scaling needs staging/prod metrics under load | Manual/external |
| Chaos/resilience | `backend/scripts/chaos-monkey-inbound.mjs` through `-RunChaos` | Optional automated |
| Recovery | Partly covered by health/build tests; service restart and queue recovery need staging drill | Manual/external |
| Idempotency | Inbound guard, workflow idempotency, deduplication suites | Automated |
| Rollback/saga | Workflow engine, compensator, reconciliation tests | Automated |
| Intent classification accuracy | `workflow-scenario-matrix.test.ts`, workflow confidence tests | Automated |
| Confidence thresholds | `workflow-confidence.test.ts`, mutation gate tests | Automated |
| Prompt regression | Prompt/sanitizer/assistant prompt suites | Automated |
| Memory consistency | buyer memory, client memory, memory recall suites | Automated |
| RAG relevance | Property knowledge and grounding guard suites | Automated, needs periodic real-data audit |
| Toxicity/safety | Sanitizer and prompt guard suites | Partial automated, needs adversarial red-team set |
| Adversarial/edge inputs | Sanitization, webhook security, mutation guard, chaos input coverage | Partial automated |
| Usability real users | Requires recorded pilot feedback and task-completion checks | Manual |
| Accessibility | Not currently a hard gate; add axe/Playwright accessibility tests | Gap |
| Localization | Existing language/polish tests are partial; needs l10n matrix | Gap |
| Conversational flow | Handset matrix, buyer scenario runner, WhatsApp workflow smoke | Optional automated/prod |
| Penetration testing | Not covered by automated gate | External |
| Authentication/authorization | Auth, RBAC, tenant boundary, route guard suites | Automated |
| Rate limiting | Rate limiter suite and webhook security tests | Automated |
| Input sanitization | Sanitization middleware and sanitizer suites | Automated |
| GDPR/data privacy | Lead GDPR and resource deletion suites | Automated |
| Secret scanning | Not in gate; run a dedicated secret scanner in CI | Gap |
| Audit logging | Agent action log route/service suites and workflow logs | Automated |
| Build/CI | Backend and frontend production builds | Automated |
| Deployment/canary | Production workflow smoke and health checks | Optional automated |
| Blue-green | Not implemented in local gate; depends on deployment platform setup | Manual/platform |
| Health checks | `/api/health`, `/api/health/live`, health route suites | Automated |
| Backup/restore | Backup script exists; restore drill evidence still required | Manual |
| Disaster recovery | Not proven by local gate | Manual/external |
| API mocking | Jest mocks across route/service suites | Automated |
| Webhook delivery | Webhook security/reliability suites and production webhook smoke | Automated/local plus optional prod |
| Queue resilience | Automation queue tests | Automated |
| Circuit breaker | Circuit breaker suite | Automated |
| Rate limit handling | Rate limiter suite | Automated |
| Schema migration | Build/prisma generate plus migration scripts; restore/migration staging run needed | Partial |
| Data integrity | Lead transition, visit state, tenant boundary, DTO tests | Automated |
| Idempotency keys | Workflow idempotency and inbound deduplication suites | Automated |
| Pagination/performance | Pagination/security and load health tests | Partial automated |
| Never-Say-No rules | Never-say-no response guard and alternative inventory suites | Automated |
| Budget stretch | Alternative inventory and buyer qualification tests | Partial automated |
| Escalation triggers | AI prompt, workflow, and agent routing tests | Automated |
| SLA for staff response | SLA/admin route tests; real SLA monitoring needs production metrics | Partial automated |

## Non-Negotiable Release Rule

For a company-facing release, the minimum evidence is:

1. Local gate passes: backend typecheck, backend Jest, frontend Vitest, backend build, frontend build.
2. Dedicated evals pass: buyer routing, response safety, button policy, staff copilot shortcuts.
3. WhatsApp behavior proof passes: workflow scenario matrix, confidence thresholds, mutation language guard, buyer/staff webhook smoke.
4. Production health is green after deploy.
5. Any category marked Manual/external is explicitly called out as not yet proven; do not imply it passed.
