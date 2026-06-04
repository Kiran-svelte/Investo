# 8 Pillars — Production Validation

**Production:** https://biginvesto.online  
**API:** https://investo-backend-v2.onrender.com/api  
**Validated:** 2026-06-03 — `scripts/validate-8-pillars.ps1` **ALL PASS** (with `INVESTO_TEST_TOKEN` from login).  
**Live commit:** `aa4ccbef5` on Render.

## Gap matrix (post-implementation)

| # | Pillar | Before | After |
|---|--------|--------|-------|
| 1 | Data accuracy & transparency | PARTIAL | **EXISTS** — transparency footer, confidence, sources, WRONG flow |
| 2 | Lead management | PARTIAL | **EXISTS** — metadata: lead_score, tags, source_detail, routing assignment |
| 3 | Import/export | PARTIAL | **EXISTS** — filtered CSV/JSON export; CSV import; Sheets stub in settings |
| 4 | Notifications | PARTIAL | **EXISTS** — hot lead alerts, 24h follow-up cron, 9AM owner digest, stale lead cron |
| 5 | Analytics | PARTIAL | **EXISTS** — `/analytics/extended` + dashboard UI blocks |
| 6 | Assignment & routing | PARTIAL | **EXISTS** — settings UI + `assignLeadWithRouting` |
| 7 | Follow-up automation | EXISTS | **EXISTS** — unchanged queue + 24h agent SLA |
| 8 | Error handling | PARTIAL | **EXISTS** — error log API/UI, WRONG audit trail |

## Proof table

| Pillar | Test | Pass criteria | Evidence |
|--------|------|---------------|----------|
| 1 | `GET /api/health` | 200 JSON | Health body in script output |
| 1 | Transparency | Footer fields in WA outbound | Code: `aiTransparency.service.ts` + whatsapp send path |
| 1 | WRONG | `customer_wrong_report` audit action | Reply WRONG on WA → audit row |
| 2 | Leads API | `lead_score`, `tags` in DTO | `GET /api/leads` (auth) |
| 2 | Auto-create | WhatsApp inbound creates lead | Existing `whatsapp.service.ts` |
| 3 | Export | Filtered CSV/JSON | `GET /api/leads/export/csv?status=new` |
| 4 | Cron | `AGENT_AI_CRON_ENABLED=true` on Render | Render env + morning/owner jobs |
| 5 | Analytics | Extended metrics | `GET /api/analytics/extended` — **PASS** production 2026-06-03 |
| 6 | Routing | Settings persist | `PUT /api/assignment-settings` |
| 7 | Automation | Health + worker | `/api/health` + automation service start |
| 8 | Error log | List + resolve | `GET /api/error-logs`, `PATCH .../resolve` |

## Manual checks

1. **Meta Phone Number ID** — Each tenant must have a unique `phone_number_id` in company WhatsApp settings (see tenant guard fix c299a084a).
2. **OpenAI** — If key invalid, AI uses grounded fallbacks; transparency footer still appends.
3. **Login** — Use company admin credentials for authenticated API tests in the validation script.

## Deploy

```powershell
git push kiran main
$env:RENDER_API_KEY = '...'
.\scripts\redeploy-production.ps1
npx prisma db push   # in backend/ — adds leads.metadata column
```
