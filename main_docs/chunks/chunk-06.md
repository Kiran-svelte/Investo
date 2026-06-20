# Chunk 06 — Owner Dashboard, Analytics & Export

| Field | Value |
|-------|-------|
| Chunk | 06 of 7 |
| Pillar | 6 — Owner sees how the business is doing |
| Priority | P1 |
| Depends on | Chunks 01, 04 (data quality) |
| Unblocks | Retention, upsell to higher plans |

---

## 1. Single-feature scope

**One focus only:** Company owners and admins get an **accurate morning snapshot** — leads, visits, conversion, agent activity — with **feature-gated analytics**, **CSV export**, and **Microsoft Clarity** behavioral insight on the web app.

---

## 2. Current state — NOW

### 2.1 Production today (working)

| Capability | Status | Code / route |
|--------------|--------|--------------|
| Dashboard KPIs | ✅ | `DashboardPage`, `GET /api/analytics/dashboard` |
| Trends chart (period selector) | ✅ | `GET /api/analytics/trends` |
| Analytics page (leads, agents, extended) | ✅ | `AnalyticsPage`, multiple analytics routes |
| Role-aware dashboard index | ✅ | `RoleAwareIndex`, feature gates |
| CSV export (when enabled) | ✅ | `csv_export` tenant feature |
| EMI calculator | ✅ | Extra sales tool |
| Microsoft Clarity | ✅ | `clarity.ts`, deployed on biginvesto.online |
| Super-admin platform health | ✅ | `PlatformHealthPage`, `ObservabilityPage` |
| SLO indicators in health API | ✅ | degraded latency alerts in prod health |

### 2.2 Test-only / partial / gaps

| Gap | Impact |
|-----|--------|
| Analytics charts basic (per NECESSARY.md) | Polish not blocker |
| Super admin gets 403 on tenant analytics without switch | Expected; UX confusion |
| SLO breached in production (latency p95 ~5s) | Owner sees slow dashboard loads |
| Billing/analytics feature mismatch | Some plans hide analytics module |
| Clarity only on frontend — no backend correlation | Support cannot tie session to API errors easily |
| Tenant quotas warn-only | No hard stop on heavy analytics export |

### 2.3 User experience TODAY

| Persona | Experience |
|---------|------------|
| **Company admin** | Login → dashboard KPIs if `analytics` feature on → drill into Analytics page. |
| **Viewer** | Read-only dashboard + analytics. |
| **Sales agent** | Simpler dashboard; may redirect to leads not full analytics. |
| **Super admin** | Companies list + platform health; not tenant CRM analytics. |

---

## 3. Target state — AFTER

### 3.1 Perfect functioning

- Dashboard loads **< 2s p95** on production (SLO green).
- KPI numbers match raw DB counts (leads today = webhook reality ±1).
- Analytics gracefully degrades: partial sections load with inline errors, not blank page.
- CSV export completes < 30s for 10k leads.
- Clarity sessions tagged with `role`, `company_id` for support debugging.
- Owner can answer: "How many visits booked this week?" without exporting to Excel.

### 3.2 User experience AFTER

| Persona | After fix |
|---------|-----------|
| **Owner** | Mobile-friendly KPI cards; tap through to lead list filtered by metric. |
| **Admin** | Agent leaderboard with response time (from conversation metrics). |
| **Super admin** | Tenant health score correlates analytics errors + SLO burn rate. |

---

## 4. Implementation plan

### Phase 1 — Performance & accuracy (week 1)

| Task | Files |
|------|-------|
| Fix dashboard p95 (query indexes, parallel fetch) | `analytics.routes.ts`, Prisma indexes |
| Dashboard partial failure UX (already partial) | `DashboardPage.tsx` harden |
| Align KPI queries with lead/visit source of truth | `analytics.service` audit |

### Phase 2 — Observability alignment (week 2)

| Task | Files |
|------|-------|
| Enable `FEATURE_SLO_ALERTS` + webhook | Railway env, `sloAlert.service` |
| Clarity `event()` for key actions (visit booked, export) | `clarity.ts`, page hooks |
| Link Sentry release to Clarity session (optional) | frontend env |

### Phase 3 — Export & enterprise reporting (week 3)

| Task | Files |
|------|-------|
| Streaming CSV for large tenants | `lead.routes` export endpoint |
| Scheduled weekly email digest | `email.service`, cron |
| Public API read-only analytics (`FEATURE_PUBLIC_API`) | `publicApi.routes` |

---

## 5. Enterprise hardening

| Control | Requirement |
|---------|-------------|
| RBAC | Analytics routes require `analytics` feature + role |
| Tenant isolation | All analytics queries filter `companyId` |
| PII in exports | Phone masking option for viewer exports |
| Rate limits | Export endpoint rate limited |
| Audit | `analytics.export_csv` logged |

**Kill switch:** Disable `analytics` tenant feature → dashboard shows friendly gate page (already implemented).

---

## 6. Real-time usage scenarios

```
08:00  Owner opens biginvesto.online on phone
  → Clarity session start → identify(userId, role, company)
  → Dashboard KPI fetch (4 parallel API calls)
  → Sees: 12 new leads, 3 visits today, 1 closed_won this week
08:05  Taps "visits today" → calendar filtered view
09:00  Opens Analytics → agent performance table
Friday: Exports leads CSV for board meeting → audit log entry
Super admin: Observability shows SLO green after Phase 1 deploy
```

---

## 7. Tests & proof gates

| Gate | Command |
|------|---------|
| Analytics integration | smoke test analytics endpoints |
| Dashboard guards | `App.guards.test.tsx` |
| Production smoke | `GET /analytics/dashboard` 200 or 403 gated |
| Clarity | Production bundle contains `clarity.ms/tag/x9uanyc7kt` |
| Load | `infra/k6/load-test.js` dashboard path |
| Manual | KPI count vs SQL count on staging |

---

## 8. Feature flags & env

| Flag | Purpose |
|------|---------|
| `analytics` (tenant) | Module access |
| `csv_export` (tenant) | Export button |
| `VITE_CLARITY_PROJECT_ID` | `x9uanyc7kt` on Vercel |
| `FEATURE_SLO_ALERTS` | Pager/webhook on burn |
| `FEATURE_PROMETHEUS_METRICS` | `/api/metrics` |

---

## 9. Definition of done

- [ ] Dashboard p95 < 2s for pilot tenant (7-day metric)
- [ ] Clarity receiving sessions from production domain
- [ ] KPI "new leads today" matches DB query ±0
- [ ] CSV export 5k rows without timeout
- [ ] SLO status not `breached` for `api_latency_p95_ms` after optimization
- [ ] Production smoke passes analytics endpoints appropriately

---

## 10. Rollout

1. Deploy query optimizations → Railway
2. Verify Clarity dashboard after 24h traffic
3. Enable SLO alerts to Slack/email webhook
4. Customer comms: "Analytics faster" release note
