# Investo — End-to-end user journey (Phase 0–2)

How to verify the sellable core locally and in production.

## Production URLs

| Service | URL |
|---------|-----|
| Frontend (Vercel) | https://frontend-navy-eight-37.vercel.app |
| Backend API | https://investo-backend-v2.onrender.com/api |
| Health | https://investo-backend-v2.onrender.com/api/health |
| Webhook | https://investo-backend-v2.onrender.com/api/webhook |

**Frontend env:** `VITE_API_URL=https://investo-backend-v2.onrender.com/api`

## Local dev stack

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3003 (or Vite default) |
| Backend API | http://localhost:3010/api |
| Env | `VITE_API_URL=http://localhost:3010/api` |

## Test accounts (seed)

| Role | Email | Password |
|------|-------|----------|
| Super admin | admin@investo.in | admin@123 |
| Company admin | admin@demorealty.in | demo@123 |
| Sales agent | rahul@demorealty.in | demo@123 |

## Journey A — Customer (WhatsApp)

1. Customer sends WhatsApp message → lead + conversation created; AI replies (RE-only, language from lead).
2. AI qualifies (budget, area, BHK) → matches from tenant `properties` or **never-say-no** tiers (upsell, nearby, stretch, pivot, waitlist, EMI).
3. Customer taps **Book Visit** → time slot (`visit-time-{uuid}-{slot}`) → row in `visits`, lead → `visit_scheduled` (from `new` via `contacted`).
4. Customer receives confirmation (property, date, agent).
5. Automation: 24h + 1h reminders; ~24h after **completed** visit → feedback WhatsApp.

**Requires:** Meta WhatsApp Cloud API configured for the tenant (Green API: text + URL fallbacks for images/documents).

## Journey B — Sales agent (dashboard)

1. Log in as `rahul@demorealty.in` → lands on **Dashboard**; sidebar: Leads, Properties (view), Conversations, Calendar, EMI, Notifications, Settings (account only).
2. Assigned lead shows visit on calendar (`/visits` API, snake_case `scheduled_at`).
3. Notification on visit scheduled / callback.
4. **Take over** conversation → AI stops; agent replies from CRM.

## Journey C — Company admin

1. Log in as `admin@demorealty.in` → forced to **Onboarding** until step 6 if incomplete.
2. **Properties** — import from media or manual create (only this role uploads).
3. **AI settings** — WhatsApp Cloud / GreenAPI credentials.
4. **Agents** — add sales_agent / operations / viewer.
5. **Settings** — Company profile, Conversion, Roles, Feature toggles (all core modules default ON for new tenants).
6. Schedule visit from calendar → same rules as WhatsApp (conflicts, past dates).
7. Mark visit **Completed** → lead → `visited`; post-visit follow-up queued.

## Journey D — Super admin (platform)

1. Log in as `admin@investo.in` → lands on **Companies**.
2. Create company (plan defaults to cheapest subscription plan if omitted).
3. Invite company admin (person+ icon) → `target_company_id` in body, temp password e.g. `Welcome@123`.
4. **Settings** — account + change password only (no tenant feature toggles).
5. **Audit logs** — platform activity.

See `docs/ROLE_USER_JOURNEYS.md` for step tables per role.

## Automated tests

```bash
cd backend
npx jest src/tests/unit/visitBooking.service.test.ts src/tests/unit/alternativeInventory.service.test.ts src/tests/unit/interactive-buttons.test.ts src/tests/unit/leadTransition.service.test.ts src/tests/unit/rbac.test.ts --no-cache

cd ../frontend
npm run test -- --run src/config/navigation.config.test.ts src/App.guards.test.tsx
```

Full matrix: `node scripts/run-full-test-matrix.mjs` (set `E2E_SKIP=1` to skip Playwright).

## Phase 4+ (not in this journey)

- Partner / portal inventory (Phase 4)
- Enterprise load / isolation suites

See `docs/MASTER_IMPLEMENTATION_SPEC.md` for the full phase map.
