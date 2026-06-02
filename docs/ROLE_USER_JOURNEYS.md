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
| 6 | Optional | Audit logs, Settings (profile) |

**Do not:** Upload properties, message as buyer, or use Leads/Agents (not in sidebar).

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

## Defaults & selections

| Area | Default |
|------|---------|
| New company plan | First subscription plan if none selected |
| New company features | All core modules enabled |
| Onboarding features UI | All core toggles ON |
| Invite temp password | `Welcome@123` suggested (company admin invite modal) |
| Company admin first login | Forced onboarding until step 6 complete |

---

## Known fixes in this release

- Super admin **invite admin** on Companies (body `target_company_id`, not query-only).
- New companies **provisioned** with features + onboarding record.
- Property upload: **company_admin only**; DB-backed browser upload by default.
