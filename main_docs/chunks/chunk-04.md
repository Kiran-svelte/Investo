# Chunk 04 — Rapport Handlers H2, H2b, H2.5 (full.md PART III)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | 04 | full.md **PART III** §III.H2, H2b, H2.5 + PART II session classes |

---

## 1. Objective

Make **Hi/Hello** behavior deterministic per full.md: first conversation vs nth, property browse without LLM escalation.

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `backend/src/services/whatsapp/whatsappTurnOrchestrator.service.ts` | `handleRapportTurn`, `handleReturningBuyerPivotTurn`, `handlePropertyBrowsingTurn`, `isPropertyBrowsingIntent` |
| `backend/src/services/buyer/buyerButtonPolicy.service.ts` | `resolveBuyerComponents` — `isReturningGreeting` suppresses buttons |
| `backend/src/tests/unit/whatsappTurnOrchestrator.rapport.test.ts` | **CREATE** |

**Import** `computeHasPriorOutbound` from `buyerSession.util.ts` (Chunk 02) — replace inline history checks in these three handlers only.

---

## 3. H2 Rapport algorithm

```
IF visitCommit.committed OR workflowSuggestion → return null
IF stage IN (visit_booking, confirmation, commitment) → return null
IF NOT isBuyerRapportMessage(text, { hasPriorOutbound }) → return null

isReturning = isReturningBuyerGreeting(text, { hasPriorOutbound })
reply = buildBuyerRapportReply(companyName, { isReturning, locationPreference })
components = isReturning ? [] : resolveBuyerComponents({ stage, outboundText, isReturningGreeting: false })
persist message ai
return TurnResult
```

---

## 4. H2b Pivot algorithm

```
IF NOT isReturningBuyerPivotReply(text) → null
reply = buildReturningBuyerPivotReply(companyName)
UPDATE conversation SET stage=qualify, selectedPropertyId=null, recommendedPropertyIds=[]
```

---

## 5. H2.5 Property browse algorithm

**Critical:** Run `runWorkflow('availability_check')` **directly** — never `classifyAndRunBuyerWorkflow` (LLM drift → false escalation).

`isPropertyBrowsingIntent` negative guards: book, visit, price, brochure, discount.

---

## 6. Button policy (full.md PART XVI + stage table)

| Stage | First-time H2 buttons |
|-------|----------------------|
| rapport | filter-apartment, filter-villa, call-me |

Returning: **zero buttons** (`isReturningGreeting: true`).

---

## 7. If it breaks

| Symptom | Fix area |
|---------|----------|
| Every message → H1 | Escalation sets takeover (Chunk 07) |
| "property" → human_escalated | H2.5 not running before H9 |
| Returning Hi shows filters | H2 `isReturning` components empty |

---

## 8. Verification

E2E: `buyer-01-rapport`, `buyer-int-filter` (browse path), H2.5 text "show me properties"

---

## Next: [chunk-05.md](./chunk-05.md)
