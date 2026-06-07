# Orchestrator Extraction & One-Outbound-Per-Turn — Walkthrough

**Completed:** 2026-06-06 (orchestrator) · **Updated:** 2026-06-07 (call booking + docs)  
**Verified against:** Investo eval suite (`npm run eval`), alignment audit, `fix.md`

---

## Task Tracker

| # | Step | Status | Evidence |
|---|------|--------|----------|
| 1 | Add `BuyerTurnInput`, `BuyerTurnDeps` to `whatsapp-turn.types.ts` | ✅ **DONE** | `backend/src/types/whatsapp-turn.types.ts` L117–152 |
| 2 | Add `resolveBrochureForAiTurn` to `brochureDelivery.service.ts` | ✅ **DONE** | Pure resolution; no send. Legacy `deliverBrochuresForAiTurn` kept for external callers. |
| 3 | H1–H9 handlers + `orchestrateWhatsAppBuyerTurn` + `resolveHeroMediaComponent` | ✅ **DONE** | `whatsappTurnOrchestrator.service.ts` |
| 4 | Wire `whatsapp.service.ts` AI branch → orchestrator + `sendTurnResult` | ✅ **DONE** | `whatsapp.service.ts` L1038–1117 |
| 5 | Cap interactive shortlist path → 1 hero image | ✅ **DONE** | L934–957: `resolveHeroMediaComponentFromPropertyIds` + `sendTurnResult` (media-only) |
| 6 | Delete `sendPropertyMediaForStage`, `sendPropertyTypeFilters`, `shouldSendPropertyMedia`, `shouldSendPropertyFilters` | ✅ **DONE** | Grep `backend/src` → 0 hits (test comment only) |
| 7 | `npx tsc --noEmit` → 0 errors | ✅ **DONE** | Verified 2026-06-06 |
| 8 | `npx jest --no-coverage` (orchestrator + eval suites) | ✅ **DONE** | 49/49 pass (eval + orchestrator + media + inbound) |
| 9 | Grep audit: 0 hits for deleted methods | ✅ **DONE** | See § Grep Audit below |
| 10 | Update walkthrough.md | ✅ **DONE** | This file |

**Note on step 1:** Orchestrator entry uses `BuyerTurnRuntimeContext` (wraps `BuyerTurnInput` + wire fields). `BuyerTurnDeps` is defined for future DI but not yet injected — handlers call prisma/services directly.

---

## Architecture After Refactor

```
Inbound Meta webhook (webhook.routes.ts)
  → whatsapp.service.ts handleIncomingMessage
      → dedup, staff routing, interactive short-circuit
      → orchestrateWhatsAppBuyerTurn (buyer AI path)
          H1  handleHumanTakeoverTurn
          H1b handleCallCommitReplyTurn (after tryCommitCustomerCallBooking)
          H2  handleRapportTurn
          H3  handleMemoryRecallTurn
          H4  handleQualificationTurn
          H5  handleVisitStatusTurn
          H6  handleVisitCommitWorkflowTurn
          H7  handleClassifierWorkflowTurn
          H8  handleVisitCommitReplyTurn
          H9  handleFullAiTurn
              → resolveBrochureForAiTurn (no send)
              → resolveHeroMediaComponent (brochure > hero)
              → enforceTurnComponentBudget (≤1 interactive + ≤1 media)
      → claimOutboundAiReply
      → sendTurnResult (text + interactive + media)
```

Interactive filter → shortlist (separate path, still in `whatsapp.service.ts`):
1. `sendInteractiveList` (property picker)
2. Optional `sendTurnResult` with 1 hero image (≤2 API calls total)

---

## One-Outbound Budget

| Turn type | Text | Interactive | Media | Max API calls |
|-----------|------|-------------|-------|---------------|
| Rapport (new) | ✅ | ✅ buttons | ❌ | ≤1 |
| Memory / qualification | ✅ | ❌ | ❌ | 1 |
| Visit status / workflow | ✅ | ✅ buttons | ❌ | ≤1 |
| Full AI (normal) | ✅ | 0–1 | 0–1 | ≤2 |
| Full AI (shortlist) | ✅ | ✅ buttons | ✅ 1 hero | ≤2 |
| Takeover handoff | ✅ | ❌ | ❌ | 1 |
| Filter → list + hero | list | — | 1 hero | ≤2 |

**Removed:** up to 18 media sends via `sendPropertyMediaForStage`.

---

## EVAL Verification (2026-06-06)

```bash
cd backend
npm run eval          # 5/5 suites, 25 eval cases
npx tsc --noEmit      # 0 errors
```

| Eval module | Cases | Result |
|-------------|-------|--------|
| `buyerRouting.eval` | 9 | ✅ PASS — matches H2–H9 cascade detectors |
| `responseSafety.eval` | 4 | ✅ PASS — sanitizer + `guardBookingClaims` |
| `buttonPolicy.eval` | 5 | ✅ PASS — `resolveBuyerComponents` |
| `outboundBudget.eval` | 2 | ✅ PASS — `enforceTurnComponentBudget` |
| `staffCopilot.eval` | 5 | ✅ PASS — unchanged by this refactor |

**Eval fix applied during verification:** H9 no longer suppresses hero image when interactive buttons exist (shortlist = buttons + hero allowed).

---

## Grep Audit

```bash
# Deleted methods — must be 0 in backend/src (excluding test comments)
rg "sendPropertyMediaForStage|sendPropertyTypeFilters|shouldSendPropertyMedia|shouldSendPropertyFilters" backend/src
# → 0 (comment in ai-property-media.test.ts only)

# Orchestrator wired
rg "orchestrateWhatsAppBuyerTurn" backend/src
# → whatsapp.service.ts + whatsappTurnOrchestrator.service.ts

# Brochure pure resolver
rg "resolveBrochureForAiTurn" backend/src
# → orchestrator + brochureDelivery.service.ts
```

---

## Key Files

| File | Role |
|------|------|
| `types/whatsapp-turn.types.ts` | `TurnResult`, `WhatsAppComponent`, `BuyerTurnInput`, `BuyerTurnDeps` |
| `services/whatsapp/whatsappTurnOrchestrator.service.ts` | H1–H9 + entry point + hero/budget helpers |
| `services/whatsapp.service.ts` | Thin sender: orchestrator delegate + `sendTurnResult` |
| `services/brochureDelivery.service.ts` | `resolveBrochureForAiTurn` (pure) |
| `services/buyer/buyerButtonPolicy.service.ts` | Interactive component policy |
| `evals/outboundBudget.eval.ts` | Regression guard for component budget |

---

## Known Remaining Gaps (outside this task scope)

| Gap | Impact |
|-----|--------|
| `more-info` interactive handler | Still sends text + brochure + images + buttons (up to 4 API calls) — not covered by evals |
| Interactive handlers bypass orchestrator | Button-tap flows use direct `sendMessage` — acceptable for UX, not unified TurnResult |
| `BuyerTurnDeps` not injected | Types exist; orchestrator uses direct imports |
| Handset scenario runner | `buyer-scenario-runner.mjs --all` not run in this verification |

---

## Manual Verification (optional)

```bash
cd backend
node scripts/buyer-scenario-runner.mjs --all   # target 12/12
```

| # | Scenario | Expected sends |
|---|----------|----------------|
| 1 | "Hi" (new buyer) | 1 text + buttons |
| 2 | "2bhk Whitefield 1.5cr" | 1 text + buttons + 1 hero |
| 3 | "Send me the brochure" | 1 text + 1 PDF |
| 4 | Same booking twice | 1 visit row, 1 reply |
| 5 | Interactive shortlist selection | list + 1 hero |
| 6 | Call Me → Change Time → `9 pm today` | 1 callback confirmation (not “visit”) |
| 7 | Brochure missing for project | No “property settings” / upload language |

---

## 2026-06-07 additions (see `fix.md`)

- **Call booking:** `tryCommitCustomerCallBooking` runs in the same turn as visit commit; `awaitingCallTime` set when prompting for callback time.
- **Staff copy guard:** `sanitizeStaffInstructionsForBuyer` on all buyer workflow + sanitizer paths.
- **Property import:** Location fields on Publish step; geocode on publish for WhatsApp location matching.

---

## Rollback Notes

If regressions appear:
- Orchestrator entry: `whatsapp.service.ts` ~L1038
- Hero cap logic: `whatsappTurnOrchestrator.service.ts` `handleFullAiTurn` + `enforceTurnComponentBudget`
- Interactive hero: `whatsapp.service.ts` ~L934

Do **not** restore `sendPropertyMediaForStage` — use `TurnResult.components` + `sendTurnResult` instead.
