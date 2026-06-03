# Investo — UI/UX audit by role (pages & pipelines)

Production: https://frontend-navy-eight-37.vercel.app · API: https://investo-backend-v2.onrender.com/api

## Feature toggles → sidebar (tenant staff)

| Feature key | Nav / route when ON | When OFF |
|-------------|---------------------|----------|
| `lead_automation` | Leads | Hidden |
| `property_management` | Properties, import | Hidden |
| `conversation_center` | Conversations | Hidden |
| `visit_scheduling` | Calendar | Hidden |
| `agent_management` | Agents | Hidden |
| `analytics` | Analytics | Hidden |
| `ai_bot` | AI Settings | Hidden |
| `notifications` | Notifications | Hidden |
| `audit_logs` | (super_admin audit only) | Hidden |
| `csv_export` | Export on Leads (company_admin) | Button hidden |

Configured in **onboarding step 3**, **Settings → Features**, or seeded on company create. Sidebar reloads after save (`dispatchCompanyFeaturesReload`).

---

## super_admin

| Page | Pipeline |
|------|----------|
| `/companies` | Create agency → **Invite admin** → hand off login |
| `/audit-logs` | Platform audit (feature `audit_logs`) |
| `/settings` | Account + password only (no tenant toggles) |

Blocked: tenant CRM, onboarding, feature/role APIs (403).

---

## company_admin

| Page | Pipeline |
|------|----------|
| `/onboarding` | 1 Profile → 2 Roles → 3 Features → 4 AI → 5 Team → 6 Complete |
| `/` | Dashboard KPIs |
| `/leads` | CRUD, assign, export (if `csv_export`) |
| `/properties` | List; **import** = company_admin only |
| `/conversations` | Monitor, takeover |
| `/calendar` | Visits schedule/complete |
| `/agents` | Add sales_agent / operations |
| `/analytics` | Reports |
| `/ai-settings` | WhatsApp + AI tone |
| `/billing` | Plan / invoices |
| `/settings` | Company, Conversion, Roles, Features |
| `/notifications` | Mark read |

---

## sales_agent

| Page | Pipeline |
|------|----------|
| `/` | Dashboard |
| `/leads` | View/update, create (no export) |
| `/properties` | View only |
| `/conversations` | Takeover, reply |
| `/calendar` | Book/update visits |
| `/emi-calculator` | EMI tool |
| `/notifications` | Alerts |
| `/settings` | Account only |

Blocked: upload, agents, AI settings, billing.

---

## operations

| Page | Pipeline |
|------|----------|
| `/calendar` | Home — visits |
| `/leads`, `/properties` | View |
| `/notifications` | Alerts |
| `/settings` | Account only |

---

## viewer

| Page | Pipeline |
|------|----------|
| `/leads` | Home — read-only |
| `/properties`, `/conversations`, `/analytics` | Read-only |
| `/settings` | Account only |

---

## buyer

No UI — WhatsApp only (`docs/ZERO_UI_BUYER.md`).

---

## Known setup rules

1. **WhatsApp on step 1** must be **unique** per agency (global DB constraint).
2. **Onboarding step 2** — enable at least one of sales_agent / operations / viewer (defaults OK).
3. **Step 5** — optional; empty invites allowed (skip team).
4. **Render deploy** must include latest backend for clear onboarding errors.

---

## Verification commands

```bash
cd frontend && npm run test -- --run src/config/navigation.config.test.ts src/App.guards.test.tsx src/pages/onboarding/OnboardingPage.test.ts src/hooks/useCompanyFeatures.test.ts
cd ../backend && npm run build && npx jest src/tests/unit/rbac.test.ts --no-cache
```
