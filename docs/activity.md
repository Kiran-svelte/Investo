# Activity Log

## 2026-06-29 - Payment lockout and checkout 403 planning

Prompt:

> 1. after free trial user can't do anything untill they pay and suscribe to plan . implemet this perfectly .
> 2. whatever i do it shows "Request failed with status code 403" , enable complete payment flow to users .

Actions:

- Created branch/worktree `codex/payment-flow-lockout` from `kiran/main` for a scoped fix.
- Inspected backend billing/subscription files: `backend/src/middleware/subscriptionEnforcement.ts`, `backend/src/routes/subscription.routes.ts`, `backend/src/services/billing/checkout.service.ts`, `backend/src/middleware/rbac.ts`, and `backend/src/app.ts`.
- Inspected frontend billing files: `frontend/src/pages/billing/BillingPage.tsx`, `frontend/src/components/billing/SubscribeModal.tsx`, `frontend/src/context/SubscriptionContext.tsx`, `frontend/src/App.tsx`, and `frontend/src/services/api.ts`.
- Identified initial root cause for the visible checkout error: `POST /api/subscriptions/checkout` requires `subscriptions:update`, but backend RBAC grants `company_admin` only `subscriptions:read`.
- Identified product-lockout gap: subscription enforcement exists only on selected mutating backend routes and does not globally steer expired users to billing on the frontend.

## 2026-06-29 - Payment lockout implementation approved

Prompt:

> Ensure all issue resolutions are tagged with a unique indentifier and propagate that indentifier to every module or page that is affected . and once done ,test it and deploy using railway :- [redacted]
> vercel :- [redacted] .

Actions:

- Treated the plan as approved and began implementation under `INVESTO-20260629-PAYMENT-LOCKOUT`.
- Confirmed the active implementation worktree is `D:\projects\Investo-payment-fix`.
- Added backend resolution tagging for `PAYMENT_LOCKOUT`.
- Allowed billing-suspended/past-due companies to authenticate for payment recovery while preserving product API lockout through subscription middleware.
- Added an app-level `/api` subscription gate with recovery-path exemptions for billing/auth/public health/invite surfaces.
- Changed checkout and confirmation routes to explicit company-admin self-service billing access and structured errors.
- Disabled production Cashfree dev-mode fallback and kept dev-mode local-only.
- Changed invoice checkout requests to pending payment records so access is not restored before payment confirmation.
- Added frontend dashboard subscription guard, billing page/modal tags, and shared payment error message handling.
- Added focused backend and frontend tests for checkout authorization, API lockout, route recovery, and generic 403 message handling.

## 2026-06-29 - Frontend build stabilization

Prompt:

> deployed ??

Actions:

- Confirmed deployment was not yet complete and continued the proof gate before commit/push/deploy.
- Reran frontend focused tests successfully.
- Found frontend production build failing on typed `motion/react` animation props and narrowed the fix to the shared motion adapter for `INVESTO-20260629-PAYMENT-LOCKOUT`.
- Found Vite build failing because npm resolved `motion-dom@12.40.0` under the `12.23.x` motion package family; pinned the motion package family with package overrides.
- Verified backend focused payment tests, backend build, frontend focused guard/error tests, and frontend production build all pass.
- Committed the fix as `10629bbf2` and pushed it to `kiran/main`.
- First Railway upload from `backend/` failed because the service expects repo root with config at `backend/railway.toml`; redeployed from repo root.
- Railway backend deploy `57318f0e-1dd7-43d6-9e0e-a77cac0ae65f` reached `SUCCESS`.
- Vercel production deploy completed and aliased to `https://biginvesto.online`.
- Live checks passed for Railway `/api/health/live`, Railway `/api/health/internal`, `https://biginvesto.online`, and `https://biginvesto.online/dashboard/billing`.

## 2026-06-29 - Cashfree checkout activation blocker

Prompt:

> what i said ??
> isaid enable complete payment flow .. where users can seletc and pay and start suscription and go and do their daily works ..

Actions:

- Confirmed the live modal still fails on UPI/card payment start, so the previous deployment did not complete the online payment flow.
- Checked Railway HTTP logs and found repeated `POST /api/subscriptions/checkout` 500 responses while product APIs correctly returned subscription lockout 402 responses.
- Reproduced the Cashfree order creation call using the Railway production environment without exposing secret values.
- Captured the Cashfree root cause: live Cashfree returned `transactions are not enabled for your payment gateway account`.
- Started a follow-up fix under `INVESTO-20260629-CASHFREE-ACTIVATION` to classify this provider response, avoid invoice/payment spam on failed online checkout, and show an exact recovery message.
- Added `CashfreeAccountNotEnabledError` handling around Cashfree order creation/fetch calls with sanitized provider logging.
- Changed online checkout ordering so Cashfree must accept the order before invoice/payment rows are created.
- Updated the subscription checkout route to return `payment_gateway_account_not_enabled` with `INVESTO-20260629-CASHFREE-ACTIVATION`.
- Updated the billing modal to surface backend resolution ids and corrected invoice copy to say access resumes after payment confirmation.
- Verified focused backend tests, focused frontend tests, backend build, and frontend build all pass.
- Committed the follow-up as `61f5977a6` and pushed it to `kiran/main`.
- Railway backend deploy `63b30f93-494f-4bdb-b478-12d6943f28ba` reached `SUCCESS`.
- Vercel production deploy `dpl_8uzEhWAegpT131jDs2by4fDuYagW` reached `READY` and was aliased to `https://biginvesto.online`.
- Live checks passed for Railway `/api/health/live`, Railway `/api/health/internal`, and `https://biginvesto.online/dashboard/billing`.

## 2026-06-30 - Production billing bypass hotfix

Prompt:

> revert it or make it non production .. in production users should use it wthout any payment for now , they cango to payment and pay , but shouldn't restrict any other flows or works now .

Actions:

- Kept the payment/billing screens available but changed subscription access enforcement to an explicit opt-in flag.
- Added `INVESTO-20260630-PRODUCTION-BILLING-BYPASS`.
- Added backend `FEATURE_SUBSCRIPTION_ACCESS_ENFORCEMENT=true` gate so normal product APIs are not blocked while the flag is off.
- Added frontend `VITE_SUBSCRIPTION_ACCESS_ENFORCEMENT=true` gate so locked subscription status does not redirect users away from their normal work while the flag is off.
- Updated tests to cover both bypass mode and explicit enforcement mode.
- Verified focused backend tests, focused frontend tests, backend build, and frontend build all pass.
- Committed the bypass as `20befab75` and pushed it to `kiran/main`.
- Railway backend deploy `417f12e2-d307-4a58-aa3e-5ba12f33886b` reached `SUCCESS`.
- Vercel production deploy completed and aliased to `https://biginvesto.online`.
- Live checks passed for Railway `/api/health/live`, Railway `/api/health/internal`, and `https://biginvesto.online/dashboard/billing`.
- Confirmed unauthenticated `/api/notifications` returns auth `401`, not subscription lockout `402`, which proves the global subscription gate no longer intercepts product routes in default production mode.

## 2026-06-30 - WhatsApp project/property media isolation

Prompt:

> this image is added to property but when project is selected why the image is sent ?? it should send when that property is choosed ,, why these mess ?? make everything isolated ,only when image and brochure are uploaded in project it should show when project is selected ,when images and docs uploaded inside property ,a agent should sent when user chosses it .. do it and test and deploy .

Actions:

- Started fix under identifier `INVESTO-20260630-PROJECT-PROPERTY-MEDIA-ISOLATION`.
- Traced buyer WhatsApp project selection through `whatsappInteractiveOrchestrator.service.ts` and `projectBrowse.service.ts`.
- Found root cause: project-level media resolvers fell back to child property brochures/images when no project-level file existed.
- Updated `projectBrowse.service.ts` so project selection only resolves media from `property_project_files`.
- Updated `whatsappInteractiveOrchestrator.service.ts` so project selection can attach project-level PDF and project-level image together with the property picker.
- Added regression coverage in `projectBrowse.service.test.ts` and `whatsappInteractiveOrchestrator.test.ts` with the same resolution identifier.
- Ran focused backend tests: `npm test -- --runInBand src/tests/unit/projectBrowse.service.test.ts src/tests/unit/whatsappInteractiveOrchestrator.test.ts src/tests/unit/whatsapp-media.test.ts` passed: 3 suites, 50 tests.
- Ran `npm run build` in `backend`; Prisma generate and TypeScript build passed.
- Cherry-picked the scoped fix onto clean `kiran/main` worktree `D:\projects\Investo-media-isolation-deploy` to avoid deploying unrelated dirty branch history.
- Pushed commit `3f37c60f1` to `kiran/main`.
- Deployed Railway `investo-backend` production from the repo root; deployment `d4a1a87f-3c2a-4efc-b082-c14a7571629e` reached `SUCCESS`.
- Verified live Railway `/api/health/live` returned 200.
- Verified live Railway `/api/health/internal` returned 200.
- Ran production smoke against `https://investo-backend-production.up.railway.app`; `npm run smoke` passed with 11 smoke tests.

## 2026-07-01 - Pending visit requests missing from Calendar

Prompt:

> user requested for site visit ,but not shown , it will be only shown once after the vsiit is confirmed wtf ??

Actions:

- Started fix under identifier `INVESTO-20260701-PENDING-VISIT-CALENDAR`.
- Created clean worktree `D:\projects\Investo-calendar-pending-visits` from fetched `kiran/main` to avoid unrelated dirty workspace changes.
- Traced dashboard Calendar UI to `frontend/src/pages/calendar/CalendarPage.tsx`; it loads `/api/calendar/events` and already has `pending_approval` rendering styles.
- Traced backend calendar aggregation to `backend/src/routes/calendar.routes.ts`; it returns `visits` and `call_requests`, but does not include pending visit rows from `booking_approval_requests`.
- Identified root cause: buyer-requested visits are stored as pending booking approvals until agent confirmation, so the dashboard Calendar has no event to render before confirmation.
- Updated `backend/src/routes/calendar.routes.ts` so `/api/calendar/events` includes non-expired pending visit approvals as `pending_approval` events with `approval_id` and `resolution_id`.
- Added `PATCH /api/calendar/visit-approvals/:id/status` for dashboard confirm/decline of visible pending visit requests.
- Updated `frontend/src/pages/calendar/CalendarPage.tsx` so pending approval events show as requested visits, use the calendar approval endpoint, and do not expose delete actions for synthetic approval events.
- Added focused regression coverage in `backend/src/tests/unit/calendar.routes.test.ts`.
- Ran focused backend test: `npm test -- --runInBand src/tests/unit/calendar.routes.test.ts` passed: 1 suite, 3 tests.
- Ran `npm run build` in `backend`; Prisma generate and TypeScript build passed.
- Ran `npm run build` in `frontend`; TypeScript and Vite production build passed.
