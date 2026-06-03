# Investo — Production readiness (agency “30-day” bar)

Maps the product “ready” definition to code, UI, and verification. Step-by-step journeys: `docs/ROLE_USER_JOURNEYS.md`, `docs/USER_JOURNEY.md`.

## Production URLs

| Service | URL |
|---------|-----|
| Frontend | https://frontend-navy-eight-37.vercel.app |
| API | https://investo-backend-v2.onrender.com/api |
| Health | https://investo-backend-v2.onrender.com/api/health |

---

## Ready criteria → implementation

| Criterion | Status | Where / how to verify |
|-----------|--------|------------------------|
| Agency onboards without DB edits | **Implemented** | Super admin: Companies → create → invite admin. Company admin: 6-step `/onboarding`. `companyProvisioning.service` seeds features/roles/AI. |
| Sales agent day in Investo | **Implemented** | Nav: leads, conversations, calendar, EMI, notifications. No property upload / AI settings (`navigation.config.ts`, `requirePropertyPublisher`). |
| Every inbound WhatsApp → attributed work | **Implemented** | `inboundWhatsAppRouting.service`, lead + conversation create; staff phones excluded from buyer AI. |
| AI failures visible / recoverable | **Partial** | Failed sends logged; `neverSayNoResponseGuard`, agent takeover. Email on WhatsApp fail: depends on SMTP env on Render. |
| Automation fires (reminders, nurture) | **Implemented** | Visit 24h/1h reminders; nurture 3d/7d/30d jobs (`MASTER_IMPLEMENTATION_SPEC` §D07). Dedup + skip closed leads. |
| Manager sees pipeline in &lt;2 min | **Implemented** | Dashboard, analytics, notifications, calendar. Viewer read-only on leads/analytics. |
| Admins change behavior without code | **Implemented** | Settings: company, conversion, roles, features. AI settings page. **Super admin excluded** from tenant settings (UI + API 403). |
| Meta outage doesn’t corrupt CRM | **Partial** | Webhook handlers fail safe; manual CRM still works. Per-tenant misconfig blocks AI only. |
| Auditable actions | **Implemented** | `audit_logs` feature; super admin `/audit-logs`. |
| Proves improvement (metrics) | **Partial** | Analytics dashboard; export when `csv_export` enabled. |

**North star:** Site visit booked in `visits` — `visitBooking.service`, WhatsApp `visit-time-{uuid}-{slot}` parsing.

---

## Role journeys (summary)

| Role | Login home | Primary flows |
|------|------------|---------------|
| **super_admin** | `/companies` | Create tenant, invite company admin, audit logs, account settings only |
| **company_admin** | `/` or `/onboarding` | 6-step onboarding, properties import, AI/WhatsApp, team, settings (all tabs) |
| **sales_agent** | `/` | Leads, conversations, calendar, EMI |
| **operations** | `/calendar` | Visits, view leads/properties |
| **viewer** | `/leads` | Read-only pipeline |
| **buyer** | WhatsApp only | No dashboard (`docs/ZERO_UI_BUYER.md`) |

Full step tables: `docs/ROLE_USER_JOURNEYS.md`.

---

## Settings & feature toggles

| Role | Settings UI | API |
|------|-------------|-----|
| super_admin | Account + change password only | `GET/PUT /api/features`, `/roles`, `/conversion-settings`, `/onboarding/setup` → **403** |
| company_admin | Company, Conversion, Roles, Features | Full tenant APIs |
| sales_agent / operations / viewer | Account only | Same 403 on tenant admin APIs |

Feature keys: `ai_bot`, `analytics`, `visit_scheduling`, `notifications`, `agent_management`, `conversation_center`, `lead_automation`, `property_management`, `audit_logs`, `csv_export`. Disabled keys hide sidebar routes (`useCompanyFeatures`).

---

## Production verification checklist

1. **Super admin** — `/settings` = account card only; `/api/features` returns 403; `/companies` + invite admin works.
2. **Company admin** — Complete onboarding; toggles persist; import property; configure WhatsApp on AI settings.
3. **Sales agent** — Cannot open `/properties/import`, `/agents`, `/ai-settings`.
4. **Health** — `GET /api/health` → `{"status":"ok",...}`.
5. **Readiness API** — `GET /api/readiness` as company admin → score + checks (WhatsApp, properties, team).

Seed accounts (rotate in production): `docs/USER_JOURNEY.md`.

---

## Onboarding step 1 (company setup)

If save fails, the most common cause is **WhatsApp number already used by another agency** (global unique per tenant). Use your agency’s dedicated business number, not one registered to another company on the platform. After backend deploy of the duplicate-phone fix, the UI shows an explicit error instead of “Failed to setup company profile”.

---

## Known gaps (user / ops action)

| Gap | Action |
|-----|--------|
| WhatsApp live traffic | Tenant must add Meta or GreenAPI credentials + verify webhook URL on Render |
| SMTP for email fallbacks | Set Render env: mail host, user, password, `MAIL_FROM` |
| Phase 4 (portals/partners API) | Not in scope for 30-day bar |
| Enterprise load / isolation tests | Phase 3 spec — not shipped |

---

## Automated tests

```bash
cd backend
npx jest src/tests/unit/rbac.test.ts src/tests/unit/onboarding.routes.hardening.test.ts --no-cache

cd ../frontend
npm run test -- --run src/config/navigation.config.test.ts src/App.guards.test.tsx src/pages/onboarding/OnboardingPage.test.ts
```

Full matrix: `node scripts/run-full-test-matrix.mjs` (`E2E_SKIP=1` to skip Playwright).
