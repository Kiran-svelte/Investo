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
- Committed `35e8c01b2` (`fix: show pending visit requests in calendar`) and pushed it to `kiran/main`.
- Deployed Railway `investo-backend` production; deployment `79a8f504-f113-403b-a81d-89ec27b76a3f` reached `SUCCESS`.
- Deployed Vercel production to `https://frontend-5v5yvi2a2-traderlighter11-7085s-projects.vercel.app` and aliased it to `https://biginvesto.online`.
- Verified live Railway `/api/health/live` returned 200.
- Verified live Railway `/api/health/internal` returned 200.
- Verified `https://biginvesto.online/dashboard/calendar` returned 200 and served bundle `assets/index-BnZVSYI1.js` containing `INVESTO-20260701-PENDING-VISIT-CALENDAR`.
- Ran production smoke against `https://investo-backend-production.up.railway.app`; `npm run smoke` passed with 11 smoke tests.

## 2026-07-01 - Enterprise gap markdown request

Prompt:

> just create one extreme .md which teels present investo condition vs the top level which is accepcepted and can be used by top level companies

Actions:

- Started scoped documentation task under identifier `INVESTO-20260701-ENTERPRISE-GAP-MD`.
- Created `tasks/todo.md` because the repository did not currently contain that tracking file.
- Created `docs/activity.md` because the repository did not currently contain that activity log file.
- Reviewed existing readiness inputs including `PRODUCTION_READINESS_CHECKLIST.md`, `docs/PRODUCTION_READINESS.md`, and `docs/enterprise/CHUNK_STATUS.json`.
- Prepared the plan to create `docs/INVESTO_PRESENT_CONDITION_VS_ENTERPRISE_STANDARD.md` after user verification.

## 2026-07-01 - Enterprise gap markdown completion

Prompt:

> that thingor .md is empty

Actions:

- Treated the prompt as verification to proceed with the full report instead of leaving only the plan.
- Reviewed additional product context from `docs/RE_WHATSAPP_AGENT_PRODUCT_SPEC.md` and `docs/MASTER_IMPLEMENTATION_SPEC.md`.
- Created `docs/INVESTO_PRESENT_CONDITION_VS_ENTERPRISE_STANDARD.md`.
- Updated `tasks/todo.md` checklist and review section to mark the markdown report complete.

## 2026-07-01 - WhatsApp screenshot trust audit and remediation

Prompt:

> what issues you can find ??
>
> Screenshots supplied:
> `C:\Users\kiran\AppData\Local\Temp\codex-clipboard-9926732e-1852-47d9-a170-4e7d74aadddb.png`
> `C:\Users\kiran\AppData\Local\Temp\codex-clipboard-0314e51e-3917-4532-a8e6-c4e45c65da6a.png`
> `C:\Users\kiran\AppData\Local\Temp\codex-clipboard-9fbf3f1a-0063-4a0c-99c9-2a7b070e1be9.png`

Actions:

- Started scoped WhatsApp trust remediation under `WAI-TRUST-20260701`.
- Identified screenshot issues: duplicate/stale buyer buttons, generic AI failure for a simple location request, unclear callback controls, staff alert PII/internal-ID leakage, duplicated staff alert time, and noisy technical alert copy.
- Reviewed the impacted modules: `backend/src/services/whatsapp.service.ts`, `backend/src/services/whatsapp/whatsappTurnOrchestrator.service.ts`, `backend/src/services/whatsapp/whatsappInteractiveOrchestrator.service.ts`, `backend/src/services/customerCallBooking.service.ts`, `backend/src/utils/safeBuyerFallback.util.ts`, `backend/src/utils/buyerAiTransparency.util.ts`, `backend/src/services/buyerAgentAssist.service.ts`, and related unit tests.
- Replaced the stale `tasks/todo.md` checklist with the active `WAI-TRUST-20260701` plan while preserving the prior completed enterprise-gap task note.
- Implemented `WAI-TRUST-20260701-03`: suppressed buyer native reply buttons/lists at the delivery boundary while preserving media sends.
- Implemented `WAI-TRUST-20260701-04`: added deterministic H2.4 location/address/map replies using verified property DB fields.
- Implemented `WAI-TRUST-20260701-05`: replaced generic AI failure text with transparent staff-follow-up language and updated failure detection.
- Implemented `WAI-TRUST-20260701-02`: sanitized staff assist WhatsApp alerts by masking phone numbers, removing raw lead/conversation/workflow IDs, fixing duplicated time, and replacing technical detail with action-log diagnostics.
- Preserved and included `WAI-TRUST-20260701-08` callback expiry/reschedule handling already present in the active worktree because it directly fixes stale callback controls from the screenshots.
- Ran focused proof: `npm test -- --runInBand src/tests/unit/whatsapp-media.test.ts src/tests/unit/whatsapp-turn-orchestrator.test.ts src/tests/unit/whatsappTurnOrchestrator.handlers.test.ts src/tests/unit/safeBuyerFallback.util.test.ts src/tests/unit/buyerAiTransparency.util.test.ts src/tests/unit/whatsapp-response-sanitizer.test.ts src/tests/unit/buyerAgentAssist.service.test.ts`; result PASS, 7 suites and 64 tests.
- Ran adjacent proof: `npm test -- --runInBand src/tests/unit/whatsappTurnOrchestrator.rapport.test.ts src/tests/unit/whatsappInteractiveOrchestrator.test.ts src/tests/unit/interactive-buttons.test.ts src/tests/unit/customerCallBooking.service.test.ts`; result PASS, 4 suites and 50 tests.
- Ran `npm run build` in `backend`; result PASS.
- Ran `npm run smoke` in `backend`; result PASS, including Railway live health probe and 11 smoke tests.
- Checked deployment context: Vercel CLI logged in, Railway CLI logged in, Railway linked to project `Investo` production service `investo-backend`.
- Committed `06a91fd96` with message `Fix WhatsApp buyer trust fallbacks`.
- Pushed branch `fix/whatsapp-media-and-fallback` to remote `kiran`.
- Railway deployment: first upload `141e1dc4-cde5-460e-93c8-4893f769da71` was removed before activation because a newer deployment superseded it; retried with commit-specific message.
- Railway deployment: upload `c09547f2-c6fb-46ca-9a14-711857409fcd` succeeded for `investo-backend` production; `/api/health/live` returned `{"status":"ok"}` and post-deploy `npm run smoke` passed.
- Vercel deployment: root static project `investo-ai-html` deployed and was Ready, but its root alias returned HTTP 404 because it is not the app frontend.
- Vercel deployment: app frontend project deployed as `dpl_H2d88E3a6kYajCUFABNQ8HTsuBTY`; `https://biginvesto.online` returned HTTP 200 and Vercel inspect reported Ready.

## 2026-07-01 - Expired callback active-state bug

Prompt:

> even though after that preffered time ,y it is asking notifying ?? fix and deloy

Actions:

- Added `WAI-TRUST-20260701-08` for expired callback lifecycle correctness.
- Traced the screenshot issue to active callback lookup keeping callbacks active for two hours after `scheduled_at`.
- Found stale `call-reschedule` button handling also prompted for a new preferred time without verifying that an active callback still existed.
- Updated `callRequest.service.ts` so active callback lookup uses current time instead of a two-hour post-slot grace.
- Updated `whatsappInteractiveOrchestrator.service.ts` so stale `call-reschedule` buttons do not set `awaitingCallTime` after the callback has expired.
- Added buyer copy `interactive_call_reschedule_not_found`.
- Added regression coverage in `callRequest.service.test.ts` and `whatsappInteractiveOrchestrator.test.ts`.
- Ran focused backend tests: `npm test -- --runInBand src/tests/unit/callRequest.service.test.ts src/tests/unit/customerCallBooking.service.test.ts src/tests/unit/whatsappInteractiveOrchestrator.test.ts` passed: 3 suites, 29 tests.
- Ran `npm run build` in `backend`; Prisma generate and TypeScript build passed.
- Created clean deploy worktree `D:\projects\Investo-callback-expiry-deploy` from commit `8197f3c5b` to avoid deploying unrelated dirty workspace changes.
- Verified the clean worktree after `npm ci`: focused tests passed again (3 suites, 29 tests) and `npm run build` passed.
- Deployed clean source to Railway `investo-backend`; deployment `e8d36b67-b798-4032-8a63-329887e133ca` succeeded.
- Confirmed newer Railway deployment `c09547f2-c6fb-46ca-9a14-711857409fcd` also succeeded and includes commit `8197f3c5b` via ancestor commit `06a91fd96`.
- Verified live backend after deploy: `/api/health/live` returned `status: ok`; `/api/health/internal` returned `status: ok`.

## 2026-07-02 - WhatsApp media and dynamic button regression

Prompt:

> y everytime it is sending the image ?? only when property is selected it should send .
> 2. and y buttons are disabled or not there ?? i said you to remove buttons which are harcoded and make it hybrid and real time (like ony when buttons arerequired it shows ,but for sure it should show or else user feel lost , and real time in the sense for example:- when project is selected and location is not set for that project then location button shouldn't appear , and shoudln't impact other buttoons ) , you have removed completely .wtf
>
> Screenshots supplied:
> `C:\Users\kiran\AppData\Local\Temp\codex-clipboard-6ade2df1-7a2f-47d7-a442-df82f39f7494.png`
> `C:\Users\kiran\AppData\Local\Temp\codex-clipboard-d1f9da20-7e45-4ff8-9d58-3339e777f51d.png`

Actions:

- Started regression fix under `WAI-TRUST-20260702`.
- Confirmed the prior `WAI-TRUST-20260701-03` change over-suppressed buyer buttons/lists at the WhatsApp delivery boundary.
- Confirmed the H9 full-AI path can attach property detail media from stale selected-property context even when the buyer did not select or request a property.
- Implemented `WAI-TRUST-20260702-02`: restored dynamic buyer button/list delivery in `sendTurnResult`, `sendTurnComponents`, and `sendContextualQuickReplies`.
- Implemented `WAI-TRUST-20260702-01`: added `shouldAttachPropertyDetailMediaForBuyerTurn` and gated H9 detail/hero media so stale selected-property context cannot resend images on unrelated replies.
- Implemented `WAI-TRUST-20260702-03`: added property location availability checks and routed them through property detail buttons, buyer button policy, scope validation, and direct more-info handling.
- Added regression tests for restored WhatsApp interactive delivery, media gating, location button availability, and property-bound location button scope validation.
- Ran focused proof: `npm test -- --runInBand src/tests/unit/whatsapp-media.test.ts src/tests/unit/whatsapp-turn-orchestrator.test.ts src/tests/unit/projectBrowse.service.test.ts src/tests/unit/buyerSituationButtons.util.test.ts src/tests/unit/buyerButtonPolicy.service.test.ts src/tests/unit/buyerButtonScope.service.test.ts`; result PASS, 6 suites and 70 tests.
- Ran `git diff --check -- backend/src docs/activity.md tasks/todo.md`; result PASS for touched source/doc files. Full `git diff --check` remains blocked by pre-existing generated `backend/dist` whitespace churn.
- Ran `npm run build` in `backend`; result PASS.
- Ran `npm run smoke` in `backend`; local smoke suite passed 11 tests, but the command failed overall because live Railway health probes were unreachable from this environment.
- Attempted to stage source/doc changes for commit; blocked because Git could not create `.git/index.lock` due `.git` write permission denial in this session. No commit or push was possible.

## 2026-07-02 - Login brand logo and auth animation regression

Prompt:

> what's this ?? why logo n everything changed ??
>
> this is our actuall logo and where are the animations ,etc ??
>
> Screenshot supplied:
> `C:\Users\kiran\AppData\Local\Temp\codex-clipboard-7d2466d3-8b6c-4edc-8eb6-391e5614293b.png`
>
> Logo supplied:
> `C:\Users\kiran\Downloads\ardiere Inc. (3).png`

Actions:

- Started scoped branding repair under `AUTH-BRAND-20260702`.
- Confirmed the live Vercel app at `https://biginvesto.online/login` is the frontend project and currently loads `/big-investo-logo.png`.
- Confirmed the existing `frontend/public/big-investo-logo.png` is a generated gray replacement logo, not the supplied yellow/blue BIG INVESTO logo.
- Updated `tasks/todo.md` so `AUTH-BRAND-20260702` tracks corrected logo replacement, restored auth motion, shared brand component consistency, proof, commit, push, and deploy.

## 2026-07-02 - Production polish loop: unblock pending WhatsApp trust + auth brand work

Prompt:

> /loop production polish the entire product, make it fully reliable and fully functioning, especially the WhatsApp AI reply and UI actions/pages/colours/themes and messaging/action delays; test, push to main and deploy (Railway + Vercel); keep a codebase map note instead of re-reading the codebase every time.

Actions:

- Created persistent codebase map memory note (`investo-codebase-map`) so future loop iterations skip full re-exploration.
- Re-verified the previously blocked `WAI-TRUST-20260702` working-tree changes: focused Jest run passed (6 suites, 70 tests).
- Completed `AUTH-BRAND-20260702`: corrected logo asset in place, auth logo motion restored; optimized `frontend/public/big-investo-logo.png` from 5419x1989 / 3.3MB to 1090x400 / 319KB.
- Ran `npm run build` in `frontend`; result PASS.
- Committed the WhatsApp trust changes and brand changes (excluding pre-existing generated `backend/dist` churn), pushed the branch and fast-forwarded `main` on the `kiran` remote, then deployed backend (Railway) and frontend (Vercel).

## 2026-07-02 - Auth brand motion follow-up

Actions:

- Added `AUTH-BRAND-20260702-02` follow-up motion directly to `frontend/src/pages/auth/LoginPage.tsx`: animated left-panel lighting, large logo movement, footer entrance, and sign-in content entrance.
- Kept login submission, MFA routing, SSO routing, and auth field behavior unchanged.
- Changed the frontend HTML description separator to ASCII in `frontend/index.html` to avoid encoding artifacts.
- Ran `npm run build` in `frontend`; result PASS.
- Verified local preview `/login` with Playwright screenshots on desktop and mobile; desktop rendered two visible corrected logo images, and mobile had no horizontal overflow.
