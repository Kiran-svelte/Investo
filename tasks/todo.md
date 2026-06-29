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
- [ ] Commit, push, redeploy Railway/Vercel, and recheck live production surfaces.

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
