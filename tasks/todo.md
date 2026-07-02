# Todo - AUTH-BRAND-20260702

Unique resolution identifiers:

- `AUTH-BRAND-20260702-01`: Production login/auth screens must use the supplied original yellow/blue BIG INVESTO logo asset, not the generated gray replacement.
- `AUTH-BRAND-20260702-02`: Auth/login brand presentation must restore visible entrance and ambient logo motion without changing auth behavior.
- `AUTH-BRAND-20260702-03`: App metadata, landing, sidebar, loaders, and auth copy must keep a consistent BIG INVESTO brand treatment using the corrected asset.
- `AUTH-BRAND-20260702-04`: Proof must include frontend build and live deploy verification for `https://biginvesto.online/login`.

## Plan

- [x] Inspect the screenshot, live Vercel deployment, and current frontend brand/logo files.
- [x] Identify the source commit that changed auth/login branding.
- [x] Replace the generated gray logo with the supplied original yellow/blue BIG INVESTO asset, cropped for app use. (`AUTH-BRAND-20260702-01`)
- [x] Restore auth/login motion around the logo, left panel, and sign-in form without changing login logic. (`AUTH-BRAND-20260702-02`)
- [x] Confirm shared brand components continue to use the corrected logo across app surfaces. (`AUTH-BRAND-20260702-03`)
- [x] Run frontend build and a focused visual/HTML verification. (`AUTH-BRAND-20260702-04`)
- [x] Commit, push, deploy, and verify the production alias. (`AUTH-BRAND-20260702-04`)

## Review

- `AUTH-BRAND-20260702-01`: replaced the generated gray logo with the supplied yellow/blue BIG INVESTO asset; optimized from 5419x1989 / 3.3MB down to 1090x400 / 319KB so the login page loads fast.
- `AUTH-BRAND-20260702-02`: `AuthBrandMark` now has an entrance animation plus ambient glow motion (respects `prefers-reduced-motion`); `InvestoLogo` keeps explicit height styling so layout does not shift.
- `AUTH-BRAND-20260702-03`: all brand surfaces render through the shared `InvestoLogo` component, so the corrected asset applies everywhere.
- Follow-up: `LoginPage` now restores visible motion on the dark auth panel, the large left-panel logo, and the sign-in content while keeping auth logic unchanged.
- Proof: `npm run build` passed in `frontend` (tsc + vite).
- Proof: local preview screenshots verified desktop and mobile `/login`; desktop rendered two visible corrected logo images, and mobile had no horizontal overflow.
- Commit/push/deploy: completed in this session together with `WAI-TRUST-20260702` (previous session was blocked by a `.git/index.lock` permission denial that is no longer present).

## Previous Task - WAI-TRUST-20260702

Unique resolution identifiers:

- `WAI-TRUST-20260702-01`: Buyer WhatsApp media must only attach property images/documents when the buyer explicitly selects or asks for a property/detail/media payload.
- `WAI-TRUST-20260702-02`: Buyer WhatsApp buttons/lists must be restored as dynamic real-time UI, not globally suppressed.
- `WAI-TRUST-20260702-03`: Location buttons must be gated by verified property location data without removing unrelated valid buttons.
- `WAI-TRUST-20260702-04`: Regression proof must cover media gating, dynamic button delivery, and location-button suppression.
- `WAI-TRUST-20260702-05`: Successful source changes must be committed and pushed when proof passes.

## Plan

- [x] Inspect the supplied WhatsApp screenshots and identify the two regressions: repeated stale property image and missing dynamic buttons/lists.
- [x] Read the current WhatsApp delivery, H9 media, property browse, and buyer button policy paths.
- [x] Restore buyer dynamic button/list delivery while keeping one primary WhatsApp payload per turn. (`WAI-TRUST-20260702-02`)
- [x] Gate H9 property detail media so stale selected-property context cannot resend images on unrelated buyer replies. (`WAI-TRUST-20260702-01`)
- [x] Add real-time location availability metadata to property detail buttons. (`WAI-TRUST-20260702-03`)
- [x] Update focused unit tests for the restored button behavior, media guard, and location gating. (`WAI-TRUST-20260702-04`)
- [x] Run focused backend tests and build/smoke where feasible. (`WAI-TRUST-20260702-04`)
- [ ] Commit and push successful source/doc changes to the current branch. (`WAI-TRUST-20260702-05`)

## Review

- `WAI-TRUST-20260702-02`: restored buyer button/list delivery in `sendTurnResult` and `sendContextualQuickReplies`; dynamic policy now decides when buttons appear instead of global suppression.
- `WAI-TRUST-20260702-01`: added H9 media gating so stale selected-property context does not resend property images on unrelated replies such as "Yes", "It was good", or "There no option to tap".
- `WAI-TRUST-20260702-03`: added property location availability checks; `location-{propertyId}` appears only when that property has address or coordinates, while Book Visit and Property Details remain available.
- Proof: `npm test -- --runInBand src/tests/unit/whatsapp-media.test.ts src/tests/unit/whatsapp-turn-orchestrator.test.ts src/tests/unit/projectBrowse.service.test.ts src/tests/unit/buyerSituationButtons.util.test.ts src/tests/unit/buyerButtonPolicy.service.test.ts src/tests/unit/buyerButtonScope.service.test.ts` passed: 6 suites, 70 tests.
- Proof: `git diff --check -- backend/src docs/activity.md tasks/todo.md` passed for touched source/doc files; full `git diff --check` is still blocked by pre-existing generated `backend/dist` whitespace churn.
- Proof: `npm run build` passed in `backend`.
- Smoke: local smoke suite passed 11 tests, but the smoke command failed overall because live Railway health URLs were unreachable from this environment.
- Commit/push: blocked by `.git` write permission denial when `git add` tried to create `.git/index.lock`; source/doc changes remain unstaged in the working tree.

## Previous Completed Task - WAI-TRUST-20260701

Unique resolution identifiers:

- `WAI-TRUST-20260701-01`: AI must not claim an action is complete unless the backend committed it.
- `WAI-TRUST-20260701-02`: Buyer/staff WhatsApp messages must not leak unnecessary internal IDs or raw customer PII.
- `WAI-TRUST-20260701-03`: Buyer WhatsApp delivery must not attach stale or unrelated reply buttons/lists.
- `WAI-TRUST-20260701-04`: Simple buyer requests such as property location must be handled deterministically when verified data exists.
- `WAI-TRUST-20260701-05`: AI failure fallback must be transparent, useful, and notify staff when it promises follow-up.
- `WAI-TRUST-20260701-06`: Callback/visit actions must remain visible to agents without duplicate or misleading buyer UI.
- `WAI-TRUST-20260701-07`: Proof must include focused tests plus backend build/smoke where available.
- `WAI-TRUST-20260701-08`: Expired callback slots must not remain active, show callback controls, or notify agents as if a future confirmed call still exists.

## Plan

- [x] Inspect the supplied WhatsApp screenshots and identify concrete product issues.
- [x] Read the current WhatsApp delivery, fallback, callback, location, and staff-alert code paths.
- [x] Disable buyer-facing native reply buttons/lists while preserving media delivery and backend action handling. (`WAI-TRUST-20260701-03`)
- [x] Replace misleading generic AI fallback text with transparent staff-follow-up language. (`WAI-TRUST-20260701-05`)
- [x] Add deterministic handling for buyer location/address requests before LLM fallback. (`WAI-TRUST-20260701-04`)
- [x] Tighten staff assist WhatsApp alerts: no raw lead/conversation IDs, no full phone, no duplicated time, no noisy technical detail. (`WAI-TRUST-20260701-02`, `WAI-TRUST-20260701-05`)
- [x] Keep callback action commitments intact while avoiding duplicate/stale buyer controls. (`WAI-TRUST-20260701-01`, `WAI-TRUST-20260701-06`)
- [x] Expire callback context after the preferred time so old confirmed calls do not trigger "notified team" or Change Time/Cancel controls. (`WAI-TRUST-20260701-08`)
- [x] Update focused unit tests for delivery, fallback, staff alert, handler order, and deterministic location behavior. (`WAI-TRUST-20260701-07`)
- [x] Run focused Jest tests and backend build; run smoke if the environment supports it. (`WAI-TRUST-20260701-07`)
- [x] Deploy and verify using the configured deployment targets/credentials available in the project context. (`WAI-TRUST-20260701-07`)
- [x] Commit and push successful changes to the current repository branch.

## Review

- `WAI-TRUST-20260701-08`: fixed active callback lookup so callbacks stop being active once the preferred time has passed.
- `WAI-TRUST-20260701-08`: fixed stale `call-reschedule` button handling so it does not ask for another preferred time unless an active future callback exists.
- `WAI-TRUST-20260701-03`: buyer native reply buttons/lists are suppressed at the WhatsApp delivery boundary; media is still delivered.
- `WAI-TRUST-20260701-04`: added H2.4 deterministic property location replies for location/address/map requests.
- `WAI-TRUST-20260701-05`: replaced generic AI failure copy with transparent staff-follow-up language.
- `WAI-TRUST-20260701-02`: staff assist WhatsApp alerts now mask customer phone numbers and omit raw lead/conversation/workflow identifiers.
- Proof: `npm test -- --runInBand src/tests/unit/callRequest.service.test.ts src/tests/unit/customerCallBooking.service.test.ts src/tests/unit/whatsappInteractiveOrchestrator.test.ts` passed: 3 suites, 29 tests.
- Proof: `npm run build` passed in `backend`.
- Deploy proof: clean Railway deploy `e8d36b67-b798-4032-8a63-329887e133ca` succeeded, then newer deployment `c09547f2-c6fb-46ca-9a14-711857409fcd` succeeded and includes commit `8197f3c5b`.
- Live proof: `https://investo-backend-production.up.railway.app/api/health/live` returned `status: ok`; `/api/health/internal` returned `status: ok`.
- Proof: focused WhatsApp/fallback/staff suites passed: 7 suites, 64 tests.
- Proof: adjacent WhatsApp interaction suites passed: 4 suites, 50 tests.
- Proof: `npm run smoke` passed, including Railway health live probe and 11 smoke tests.
- Deploy: committed `06a91fd96` and pushed branch `fix/whatsapp-media-and-fallback` to `kiran`.
- Deploy: Railway `investo-backend` production upload `c09547f2-c6fb-46ca-9a14-711857409fcd` succeeded; live health returned `{"status":"ok"}`.
- Deploy: Vercel frontend production `dpl_H2d88E3a6kYajCUFABNQ8HTsuBTY` succeeded; `https://biginvesto.online` returned HTTP 200.

## Previous Completed Task

- `INVESTO-20260701-ENTERPRISE-GAP-MD`: Created `docs/INVESTO_PRESENT_CONDITION_VS_ENTERPRISE_STANDARD.md` comparing current Investo condition with the enterprise standard.
