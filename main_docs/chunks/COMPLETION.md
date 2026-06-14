# Multi-Project Enterprise UX — Completion Sign-off

## Program status

| Item | Status |
|------|--------|
| Chunks 01–09 merged to `main` | ✅ |
| MP-01..MP-08 matrix green | ✅ (unit tests) |
| Single-project parity green | ✅ |
| buyerEnterpriseUx button matrix green | ✅ |
| buyerCopyCompliance green | ✅ |
| npm run smoke green | ✅ |
| Staging shadow period | _Pending — set dates after deploy_ |
| Production pilot 10% | _Pending_ |
| Full rollout | _Pending — target ~2 weeks clean metrics_ |
| Kill switch tested in staging | _Pending_ |

## MP matrix (unit-level proof)

| ID | Proves | Test file |
|----|--------|-----------|
| MP-01 | Focus sticks after project browse | `buyerEnterpriseMultiProject.matrix.test.ts` |
| MP-02 | Outbound validator strips cross-project prices | same |
| MP-03 | Same-day visits → disambiguation on confirm | same |
| MP-04 | Ordinal "2" confirms correct visit | same |
| MP-05 | Active visit A + more-info B → visit buttons | same |
| MP-06 | Second booking on different project allowed | same |
| MP-07 | Multi-list suppresses wrong Book Visit | same |
| MP-08 | Single-project catalog parity | same |

## Staged production rollout

### Phase 0 — Shadow (staging only)

```env
FEATURE_SHADOW_MODE=true
FEATURE_MULTI_VISIT_CONTEXT=true
FEATURE_BUYER_FOCUS_STACK=true
FEATURE_SCOPED_PROPERTY_RESOLVE=true
FEATURE_SCOPED_AI_CATALOG=true
FEATURE_VISIT_DISAMBIGUATION=true
FEATURE_BUTTON_SCOPE_VALIDATE=true
FEATURE_OUTBOUND_PROPERTY_VALIDATE=true
FEATURE_SECOND_VISIT_POLICY=true
```

Watch logs: `liveLeadContext.multiVisit`, `buyerFocus.updated`, `buyerButton.scopeViolation`, `buyerOutboundValidator.shadow`

### Phase 1 — Single-project prod parity

All flags ON for single-project tenants first; compare against enterprise v2 baseline.

### Phase 2 — Multi-project pilot

```env
FEATURE_ROLLOUT_PERCENTAGE=10
```

Applies to lead-scoped: `scopedAiCatalog`, `outboundPropertyValidate` via `featureRollout.util.ts`.

### Phase 3 — Full rollout

All flags ON after ~2 weeks clean metrics. Optional PR to flip defaults in `config/index.ts`.

### Kill switches (instant, no redeploy)

Set any `FEATURE_*=false` on Railway.

## Verification command rollup

```bash
cd backend
npm run smoke
npm test -- --testPathPattern="buyerEnterprise|buyerProperty|liveLead|visitMutation|buyerSituation|buyerFocus|buyerOutbound|buyerScoped|interactive|buyerCopy"
npx tsc --noEmit
```

## Signed

- Engineering: _Auto-implemented chunks 01–10; staging E2E handset proof pending_
- QA: _MP-01..MP-08 unit matrix passed locally_
- Date: 2026-06-14
