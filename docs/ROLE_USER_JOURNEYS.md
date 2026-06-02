# Investo — user journey by role

Step-by-step flows for production. Navigation rules: `docs/ROLE_NAVIGATION.md`.

---

## 1. Super Admin (platform developer / you)

**Purpose:** Create tenants (agencies). No tenant CRM (no leads, properties, WhatsApp inbox in UI).

| Step | Action | Where |
|------|--------|--------|
| 1 | Log in | `/login` → lands on **Companies** |
| 2 | Create company | Companies → **New company** → name, slug, WhatsApp number, **plan** (defaults to first plan) |
| 3 | System seeds tenant | Features, roles, AI stub, onboarding step 0 (automatic) |
| 4 | Invite company admin | Companies row → **person+** icon → name, email, temp password |
| 5 | Hand off credentials | Send admin email + password securely (not via chat) |
| 6 | Optional | Audit logs, **Settings** (account only — change password; **no** Company Profile / Roles / Feature Toggles) |

**Settings UI:** Account card + change-password link only. Backend returns 403 on `/api/features` for super_admin.

**Do not:** Upload properties, message as buyer, or use Leads/Agents (not in sidebar). Do not use `/onboarding` (company_admin only).

---

## 2. Company Admin (agency owner)

**Purpose:** Onboard tenant, inventory, AI, team; run the business.

| Step | Action | Where |
|------|--------|--------|
| 1 | First login | Redirect to **Onboarding** (6 steps) if incomplete |
| 2 | Step 1 — Company profile | Name, description, WhatsApp, brand color |
| 3 | Step 2 — Roles | Enable sales_agent, operations, viewer |
| 4 | Step 3 — Features | Defaults on (AI, leads, visits, properties, etc.) |
| 5 | Step 4 — AI settings | Tone, locations, budget, greeting |
| 6 | Step 5 — Invite team | Name, email, role, **password per user** (≥8 chars) |
| 7 | Step 6 — Complete | Dashboard unlocked |
| 8 | Properties | **Import from media** or manual create (only this role uploads) |
| 9 | AI settings | WhatsApp Cloud / GreenAPI credentials |
| 10 | Agents | Add sales_agent / operations |
| 11 | Day-to-day | Leads, conversations, calendar, analytics, billing |
| 12 | Settings | Company profile, **Conversion**, roles, feature toggles (full tenant settings) |

**Gate:** Incomplete property catalog can block other APIs until listings are complete (`423`); finish import on Properties.

---

## 3. Sales Agent

| Step | Action |
|------|--------|
| 1 | Login (from onboarding invite or admin-created user) |
| 2 | Dashboard → Leads, Conversations, Calendar |
| 3 | Qualify leads, take over chats, book visits |
| 4 | EMI calculator, notifications |
| 5 | **Cannot** upload properties, manage billing, or AI settings |

---

## 4. Operations

| Step | Action |
|------|--------|
| 1 | Login → lands on **Calendar** |
| 2 | Visits, view leads/properties, notifications |
| 3 | **Cannot** upload properties or edit AI |

---

## 5. Viewer

| Step | Action |
|------|--------|
| 1 | Login → lands on **Leads** (read-only) |
| 2 | View leads, properties, conversations, analytics |
| 3 | **Cannot** create or export |

---

## 6. Buyer (customer)

| Step | Action |
|------|--------|
| 1 | Message agency **business WhatsApp** (any phone not on staff User list) |
| 2 | Customer AI replies — no dashboard account |
| 3 | Qualification → shortlist → book visit via chat buttons |
| 4 | Agent follows up in CRM |

See `docs/ZERO_UI_BUYER.md`.

---

## Settings tabs by role

| Tab | super_admin | company_admin | sales_agent / operations / viewer |
|-----|-------------|---------------|----------------------------------|
| Company profile | — | ✓ | — |
| Conversion | — | ✓ | — |
| Roles management | — | ✓ | — |
| Feature toggles | — | ✓ | — |
| Account / password | ✓ | ✓ (via same page when no tenant tabs) | ✓ (account only) |

Feature keys (company_admin): `ai_bot`, `analytics`, `visit_scheduling`, `notifications`, `agent_management`, `conversation_center`, `lead_automation`, `property_management`, `audit_logs`, `csv_export`. Disabled toggles hide matching sidebar routes (except super_admin nav).

---

## Defaults & selections

| Area | Default |
|------|---------|
| New company plan | Cheapest subscription plan (`priceMonthly` asc) if none selected |
| New company modal plan | First plan in list when opening **New company** |
| New company features | All core modules enabled (`companyProvisioning.service`) |
| Onboarding features UI | All core toggles ON |
| Invite temp password | `Welcome@123` suggested (Companies invite + onboarding step 5) |
| Company admin first login | Forced onboarding until step 6 complete |
| Operations login home | `/calendar` |
| Viewer login home | `/leads` |
| Super admin login home | `/companies` |

---

## Production verification checklist

1. **Super admin** — `/settings` shows account only; `/companies` works; `/leads` redirects home; `GET /api/features` returns **403**.
2. **Company admin** — onboarding → settings toggles persist; nav respects disabled features.
3. **Sales agent** — cannot open `/agents` or `/ai-settings`; can book visits.
4. **Health** — `GET /api/health` returns 200 on Render backend.
5. **30-day readiness** — see `docs/PRODUCTION_READINESS.md`.

---

## “Ready” definition (agency can run 30 days)

Investo is **ready for a pilot agency** when they can: connect WhatsApp, load projects, book visits from buyer chats, and managers see pipeline in one place—without manual DB edits. Detailed criterion map: `docs/PRODUCTION_READINESS.md`.

---

## Implementation notes (this release)

- Super admin **invite admin** on Companies (`target_company_id` in POST body).
- New companies **provisioned** with features, roles, AI stub, onboarding step 0.
- Property upload: **company_admin only**; DB-backed browser upload by default.
- **Tenant settings APIs** return 403 for `super_admin` (features, roles, conversion, onboarding setup).
- Platform **Settings** UI: account + password only for super admin and non-admin staff.
