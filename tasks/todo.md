# Todo - WAI-TRUST-20260701

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
