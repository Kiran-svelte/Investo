# Todo - INVESTO-20260629-PAYMENT-LOCKOUT

Unique resolution identifier: `INVESTO-20260629-PAYMENT-LOCKOUT`

## Plan

- [x] Backend RBAC checkout fix: allow company admins to initiate and confirm their own subscription payment flow without opening broader platform subscription administration.
- [x] Backend expired-trial lockout: enforce inactive subscription access consistently for tenant product APIs while allowing the minimum recovery surface: subscription status, checkout, payment confirmation, invoices, profile, auth/session, health, and platform-admin routes.
- [x] Backend payment error contract: return structured, user-safe billing errors with code/message/request identifier so the UI never shows raw `Request failed with status code 403`.
- [x] Frontend billing recovery path: when `hasAccess=false`, keep users inside the billing/payment route and prevent normal dashboard/product pages from being usable until subscription activation.
- [x] Frontend checkout UX: map checkout errors into clear messages, keep payment options actionable, and refresh subscription state after successful Cashfree confirmation.
- [x] Propagate `INVESTO-20260629-PAYMENT-LOCKOUT` to affected backend middleware/routes/tests and frontend billing/guard/error handling files.
- [x] Add focused tests for company-admin checkout authorization, expired-trial lockout, billing recovery route allowance, and frontend payment error messaging.
- [x] Run focused backend Jest tests, backend build, focused frontend tests, and frontend build.
- [x] Update this file's Review section with changed files, root cause, proof, and any production limitations.
- [x] Commit, push, deploy Railway backend and Vercel frontend, then re-check production health and payment recovery behavior.

## Review

Root causes fixed:

- Checkout 403: `POST /api/subscriptions/checkout` used generic `subscriptions:update` RBAC, while `company_admin` only had `subscriptions:read`; company admins could view billing but could not pay.
- Expired-trial loophole: subscription checks were route-by-route only, so unpaid tenants could still reach parts of the product after trial expiry.
- Misleading payment activation: invoice checkout marked invoices paid and activated access before confirmed payment.
- Raw frontend error: generic Axios failures surfaced as `Request failed with status code 403` instead of user-safe billing messages.
- Build instability: the animation package family drifted to an incompatible `motion-dom` version during install/build.

Changes made under `INVESTO-20260629-PAYMENT-LOCKOUT`:

- Added backend payment recovery access helper and structured subscription lockout errors with `resolutionId`.
- Added app-level `/api` paid-subscription gate for tenant product APIs while keeping auth, billing recovery, health, invite, webhook, and platform/API-key surfaces reachable.
- Replaced checkout/confirm/select-plan generic RBAC with company-admin billing self-service authorization.
- Made production Cashfree misconfiguration fail safely instead of returning dev-mode checkout payloads.
- Kept invoice and bank-transfer requests pending until payment is confirmed.
- Added frontend dashboard subscription guard so company admins land on billing and staff see a locked-workspace message.
- Added user-safe payment error messages and resolution tags on billing page/modal surfaces.
- Pinned `motion`, `framer-motion`, `motion-dom`, and `motion-utils` through package metadata/overrides so frontend builds are repeatable.

Proof:

- `backend`: `npm test -- --runTestsByPath src/tests/unit/subscription.routes.payment-lockout.test.ts src/tests/unit/payment-lockout.middleware.test.ts --runInBand` passed: 2 suites, 6 tests.
- `backend`: `npm run build` passed.
- `frontend`: `npm test -- --run src/App.guards.test.tsx src/utils/apiErrorMessage.test.ts` passed: 2 files, 18 tests.
- `frontend`: `npm run build` passed.

Production limitations to verify after deploy:

- Real card/UPI activation still depends on valid Cashfree production environment values being present in Railway.
- Live browser payment completion requires an authenticated expired company-admin session and a real/sandbox payment return path.

Deployment proof:

- Commit `10629bbf2` pushed to `kiran/main`.
- Railway backend deploy `57318f0e-1dd7-43d6-9e0e-a77cac0ae65f` reached `SUCCESS`.
- Railway live checks passed: `/api/health/live` 200 and `/api/health/internal` 200.
- Vercel production deployment completed and aliased to `https://biginvesto.online`.
- Frontend live checks passed: `https://biginvesto.online` 200 and `https://biginvesto.online/dashboard/billing` 200.

---

# Todo - INVESTO-20260629-CASHFREE-ACTIVATION

Unique resolution identifier: `INVESTO-20260629-CASHFREE-ACTIVATION`

## Plan

- [x] Capture the live Cashfree checkout root cause and record it without exposing credentials.
- [x] Backend: classify Cashfree merchant-account-disabled responses instead of returning generic checkout failure.
- [x] Backend: stop creating invoices/payment rows before online Cashfree order creation succeeds.
- [x] Frontend: show the exact payment-gateway activation message and keep invoice/bank-transfer alternatives clear.
- [x] Propagate `INVESTO-20260629-CASHFREE-ACTIVATION` to affected backend/frontend modules and tests.
- [x] Run focused backend tests, backend build, focused frontend tests, and frontend build.
- [x] Commit, push, redeploy Railway/Vercel, and recheck live production surfaces.

## Review

Root cause:

- The live Cashfree order API rejected production UPI/card checkout with `transactions are not enabled for your payment gateway account`.
- That is a Cashfree merchant-account activation blocker, not a frontend click handler or RBAC problem.
- The app was also creating invoice/payment records before Cashfree accepted online orders, which could spam pending invoices on every failed card/UPI retry.

Changes made under `INVESTO-20260629-CASHFREE-ACTIVATION`:

- Backend now maps this Cashfree provider response to `payment_gateway_account_not_enabled` with resolution id `INVESTO-20260629-CASHFREE-ACTIVATION`.
- Backend logs the sanitized provider status/code/message without exposing credentials.
- Online checkout now creates Cashfree order first and only creates invoice/payment records after Cashfree returns a valid checkout session.
- Frontend modal now displays the backend's exact gateway activation message and tags the error block with the backend resolution id.
- Stale invoice copy was corrected so invoice/bank transfer do not imply immediate access before payment confirmation.

Proof:

- `backend`: `npm test -- --runTestsByPath src/tests/unit/subscription.routes.payment-lockout.test.ts src/tests/unit/payment-lockout.middleware.test.ts src/tests/unit/cashfree-activation.checkout.test.ts --runInBand` passed: 3 suites, 8 tests.
- `frontend`: `npm test -- --run src/App.guards.test.tsx src/utils/apiErrorMessage.test.ts` passed: 2 files, 19 tests.
- `backend`: `npm run build` passed.
- `frontend`: `npm run build` passed.

Production limitation:

- Real UPI/card payment cannot complete until Cashfree enables transactions for the merchant account, or production is switched to another active gateway account.

Deployment proof:

- Commit `61f5977a6` pushed to `kiran/main`.
- Railway backend deploy `63b30f93-494f-4bdb-b478-12d6943f28ba` reached `SUCCESS`.
- Vercel production deploy `dpl_8uzEhWAegpT131jDs2by4fDuYagW` reached `READY` and was aliased to `https://biginvesto.online`.
- Live checks passed: Railway `/api/health/live` 200, Railway `/api/health/internal` 200, and `https://biginvesto.online/dashboard/billing` 200.

---

# Todo - INVESTO-20260630-PRODUCTION-BILLING-BYPASS

Unique resolution identifier: `INVESTO-20260630-PRODUCTION-BILLING-BYPASS`

## Plan

- [x] Keep Billing and checkout available, but stop subscription status from blocking normal production CRM/workspace routes.
- [x] Backend: make subscription access enforcement opt-in through `FEATURE_SUBSCRIPTION_ACCESS_ENFORCEMENT=true`.
- [x] Backend: bypass global `/api` subscription gate and route-level paid-subscription middleware when the flag is off.
- [x] Frontend: bypass `SubscriptionAccessGuard` when `VITE_SUBSCRIPTION_ACCESS_ENFORCEMENT` is not `true`.
- [x] Keep tests proving both modes: bypass by default and lockout only when explicitly enabled.
- [x] Run focused backend/frontend tests and builds.
- [x] Commit, push, deploy Railway/Vercel, and recheck production.

## Review

Root cause:

- The previous payment-lockout implementation made production access depend on paid subscription state while the live Cashfree merchant account is not yet transaction-enabled.
- That created the wrong production behavior for the current phase: users could see Billing, but expired/past-due state could block normal workspace routes.

Changes made under `INVESTO-20260630-PRODUCTION-BILLING-BYPASS`:

- Billing remains enabled, so users can still open Billing and attempt payment.
- Backend access enforcement is now opt-in with `FEATURE_SUBSCRIPTION_ACCESS_ENFORCEMENT=true`.
- Backend global `/api` subscription gate and route-level paid-subscription middleware bypass product blocking while the flag is off.
- Frontend `SubscriptionAccessGuard` bypasses redirects/lock screens unless `VITE_SUBSCRIPTION_ACCESS_ENFORCEMENT=true`.
- Tests cover both modes: production bypass by default and lockout when explicitly enabled.

Proof:

- `backend`: `npm test -- --runTestsByPath src/tests/unit/payment-lockout.middleware.test.ts src/tests/unit/subscription.routes.payment-lockout.test.ts src/tests/unit/cashfree-activation.checkout.test.ts --runInBand` passed: 3 suites, 9 tests.
- `frontend`: `npm test -- --run src/App.guards.test.tsx src/utils/apiErrorMessage.test.ts` passed: 2 files, 20 tests.
- `backend`: `npm run build` passed.
- `frontend`: `npm run build` passed.

Production expectation:

- With the new default, production users should be able to continue normal CRM/workspace flows regardless of trial/payment state.
- Billing remains available for users to attempt payment, but Cashfree card/UPI still depends on the merchant account being transaction-enabled.

Deployment proof:

- Commit `20befab75` pushed to `kiran/main`.
- Railway backend deploy `417f12e2-d307-4a58-aa3e-5ba12f33886b` reached `SUCCESS`.
- Vercel production deploy completed and aliased to `https://biginvesto.online`.
- Railway `/api/health/live` returned 200.
- Railway `/api/health/internal` returned 200.
- `https://biginvesto.online/dashboard/billing` returned 200 and served bundle `assets/index-By9k1Hzd.js` containing `INVESTO-20260630-PRODUCTION-BILLING-BYPASS`.
- Unauthenticated `/api/notifications` returned normal auth `401`, not subscription lockout `402`, confirming the global subscription gate is bypassed in production default mode.

---

# Todo - INVESTO-20260630-PROJECT-PROPERTY-MEDIA-ISOLATION

Unique resolution identifier: `INVESTO-20260630-PROJECT-PROPERTY-MEDIA-ISOLATION`

## Plan

- [x] Root cause: trace WhatsApp project selection and property detail selection media resolution.
- [x] Backend isolation: project selection must only attach project-level files from `property_project_files`.
- [x] Backend isolation: property detail selection must continue attaching only the selected property's images and brochure.
- [x] Tests: add regression coverage proving project selection does not fall back to child property images/brochures.
- [x] Tests: add coverage proving project-level image/PDF files still attach on project selection.
- [x] Run focused backend tests and backend build.
- [x] Commit, push, and deploy backend after proof passes.

## Review

- Root cause: `resolveProjectBrochureMediaComponent` and `resolveProjectHeroImageComponent` fell back to child property media when project-level media was missing.
- Fix: project selection now only attaches PDFs/images uploaded to `property_project_files` for that project.
- Fix: property images and property brochures remain attached only when the buyer taps a specific property (`more-info-*` / property details path).
- Behavior: if a project has both a project-level PDF and project-level image, project selection can send both along with the property picker.
- Proof: `npm test -- --runInBand src/tests/unit/projectBrowse.service.test.ts src/tests/unit/whatsappInteractiveOrchestrator.test.ts src/tests/unit/whatsapp-media.test.ts` passed: 3 suites, 50 tests.
- Proof: `npm run build` passed in `backend`.
- Commit `3f37c60f1` pushed to `kiran/main`.
- Railway backend deploy `d4a1a87f-3c2a-4efc-b082-c14a7571629e` reached `SUCCESS`.
- Railway live checks passed: `/api/health/live` 200 and `/api/health/internal` 200.
- Production smoke passed against `https://investo-backend-production.up.railway.app`: `npm run smoke` passed with 11 smoke tests.

---

# Todo - INVESTO-20260701-PENDING-VISIT-CALENDAR

Unique resolution identifier: `INVESTO-20260701-PENDING-VISIT-CALENDAR`

## Plan

- [x] Root cause: trace buyer-requested site visit storage through approval-first booking and the dashboard Calendar event API.
- [x] Backend fix: make `/api/calendar/events` include pending buyer visit approvals as tenant-scoped `pending_approval` visit events before agent confirmation.
- [x] Backend safety: preserve company/agent scoping, date-range filtering, and avoid duplicating confirmed visits.
- [x] Frontend UX: keep Calendar rendering pending visit requests clearly and avoid invalid update/delete actions for synthetic approval events.
- [x] Tests: add focused regression proof for pending visit approvals appearing in Calendar events.
- [x] Build/test: run focused backend tests and backend build; run frontend build if the Calendar page changes.
- [ ] Deploy: commit, push, deploy backend to Railway and frontend to Vercel if touched, then smoke-check production.

## Review

- Root cause: Calendar aggregated `visits` and `call_requests`, but buyer-requested visits are stored in `booking_approval_requests` until agent approval, so pending requests were invisible before confirmation.
- Backend fix: `/api/calendar/events` now returns pending visit approvals as `pending_approval` visit events tagged with `INVESTO-20260701-PENDING-VISIT-CALENDAR`.
- Backend fix: `PATCH /api/calendar/visit-approvals/:id/status` lets the dashboard confirm/decline those visible pending requests using the existing visit approval resolver.
- Frontend fix: Calendar displays pending requests as `Requested`, calls the calendar approval endpoint for confirm/decline, and hides delete actions for synthetic approval events.
- Proof: `npm test -- --runInBand src/tests/unit/calendar.routes.test.ts` passed: 1 suite, 3 tests.
- Proof: `npm run build` passed in `backend`.
- Proof: `npm run build` passed in `frontend`.
- Pending: commit, push, production deploy, and live smoke checks.
