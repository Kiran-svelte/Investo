# Platform isolation remediation plan

## Root cause (P0 — fixed)

`strictTenantIsolation` only read `target_company_id` from **query string**, but Companies/Agents pages send it in the **JSON body**. Middleware rejected valid platform-admin actions before route handlers ran.

## Target architecture

| Context | Who | How tenant is scoped |
|---------|-----|----------------------|
| **Platform management** | `super_admin` on `/companies`, invite flows | Per-action `target_company_id` in query **or** body |
| **Tenant inspection** | `super_admin` browsing CRM | Sidebar tenant switcher → query param on all CRM reads |
| **Tenant staff** | `company_admin`, agents, etc. | Server-side `user.company_id` only |

## Issue backlog

### P0 — UX broken (fix first)

| # | Area | Issue | Fix |
|---|------|-------|-----|
| 1 | `tenant.ts` | Body `target_company_id` ignored | `resolveSuperAdminTargetCompanyId()` — query + body |
| 2 | `api.ts` | Interceptor only used session storage | Promote body/query `target_company_id` to query params |
| 3 | `CompaniesPage` | Invite admin fails | Sync sidebar tenant on row action + body fix |

### P1 — Super-admin CRM gaps

| # | Area | Issue | Fix |
|---|------|-------|-----|
| 4 | `AgentsPage` | Super admin loads `/users` without tenant | Gate with tenant banner or company filter |
| 5 | `AISettingsPage` | UI still allows super_admin; API rejects platform shell | Hide page for super_admin (nav already does) |
| 6 | `audit.routes` | Needs `target_company_id` or `company_id` | Document + frontend audit page filter |
| 7 | `copilot.routes` | Super admin needs tenant for chat | Require sidebar tenant; show empty state |
| 8 | Notifications/analytics | Same tenant requirement | Reuse `TenantRequiredBanner` component |

### P1 — Security & correctness

| # | Area | Issue | Fix |
|---|------|-------|-----|
| 9 | `property-tools.ts` | Mutation tools registered for viewer (runtime guard only) | Split read/mutation tool sets in `getToolsForRole` |
| 10 | `metrics.routes` | Private-IP scrape bypass | Restrict to internal auth or remove |
| 11 | `webhook.routes` | Dev `/test` may match lead by phone only | Scope by company |
| 12 | Upload tokens | HMAC only; no rate limit | Add per-company rate limit on upload route |

### P2 — Reliability / performance / observability

| # | Pillar | Issue | Target |
|---|--------|-------|--------|
| 13 | Performance | Analytics 60s cache; cold DB 5s+ on health | Redis warm path; DB connection pool tuning; p95 < 2s |
| 14 | Observability | No deploy version in UI | Show `health/live.build` in admin footer |
| 15 | Reliability | Railway skip deploy on watch patterns | Bump `package.json` on release; verify `deploy_note` |
| 16 | Recoverability | No documented DR runbook | Supabase PITR + S3 versioning doc |
| 17 | Scalability | Single Railway instance | Horizontal replicas + Redis session when >50 tenants |
| 18 | Testing | Full unit suite has unrelated failures | CI gate on isolation + critical path smoke only |

## Expected output (acceptance)

1. **Invite admin** from Companies table → creates `company_admin` without sidebar pre-selection.
2. **Sidebar tenant** still required for Leads/Analytics/Notifications browse.
3. **Super admin** never sees platform shell company in tenant picker.
4. **WhatsApp** idle until tenant configures Meta in AI Settings.
5. **Production proof**: `node backend/scripts/verify-phase2-isolation.mjs` + invite E2E.

## Deployment checklist

- [ ] `npm run build` backend + frontend
- [ ] Isolation unit tests pass
- [ ] Push to `kiran/main`
- [ ] Railway deploy → `deploy_note` matches
- [ ] `npx vercel deploy --prod` → biginvesto.online
