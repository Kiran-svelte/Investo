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
- [ ] Disable buyer-facing native reply buttons/lists while preserving media delivery and backend action handling. (`WAI-TRUST-20260701-03`)
- [ ] Replace misleading generic AI fallback text with transparent staff-follow-up language. (`WAI-TRUST-20260701-05`)
- [ ] Add deterministic handling for buyer location/address requests before LLM fallback. (`WAI-TRUST-20260701-04`)
- [ ] Tighten staff assist WhatsApp alerts: no raw lead/conversation IDs, no full phone, no duplicated time, no noisy technical detail. (`WAI-TRUST-20260701-02`, `WAI-TRUST-20260701-05`)
- [ ] Keep callback action commitments intact while avoiding duplicate/stale buyer controls. (`WAI-TRUST-20260701-01`, `WAI-TRUST-20260701-06`)
- [x] Expire callback context after the preferred time so old confirmed calls do not trigger "notified team" or Change Time/Cancel controls. (`WAI-TRUST-20260701-08`)
- [ ] Update focused unit tests for delivery, fallback, staff alert, handler order, and deterministic location behavior. (`WAI-TRUST-20260701-07`)
- [ ] Run focused Jest tests and backend build; run smoke if the environment supports it. (`WAI-TRUST-20260701-07`)
- [ ] Deploy and verify using the configured deployment targets/credentials available in the project context. (`WAI-TRUST-20260701-07`)
- [ ] Commit and push successful changes to the current repository branch.

## Review

- `WAI-TRUST-20260701-08`: fixed active callback lookup so callbacks stop being active once the preferred time has passed.
- `WAI-TRUST-20260701-08`: fixed stale `call-reschedule` button handling so it does not ask for another preferred time unless an active future callback exists.
- Proof: `npm test -- --runInBand src/tests/unit/callRequest.service.test.ts src/tests/unit/customerCallBooking.service.test.ts src/tests/unit/whatsappInteractiveOrchestrator.test.ts` passed: 3 suites, 29 tests.
- Proof: `npm run build` passed in `backend`.

## Previous Completed Task

- `INVESTO-20260701-ENTERPRISE-GAP-MD`: Created `docs/INVESTO_PRESENT_CONDITION_VS_ENTERPRISE_STANDARD.md` comparing current Investo condition with the enterprise standard.
