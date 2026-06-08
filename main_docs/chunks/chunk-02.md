# Chunk 02 — Session Taxonomy (full.md PART II)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | **Done** |

---

## 1. Objective

Centralize **1st vs nth conversation** detection and `/start` reset so H2/H2b/H1b/H9 all use one module — matching full.md exactly. Remove duplicate `hasPriorOutbound` calculations inside orchestrator.

---

## 2. Files IN SCOPE

| File | Changes |
|------|---------|
| `backend/src/services/buyerQualification.service.ts` | Export stable predicates: `isBuyerRapportMessage`, `isReturningBuyerGreeting`, `isReturningBuyerPivotReply`, builders |
| `backend/src/services/buyer/buyerStartFresh.service.ts` | `/start` reset: `resetBuyerBookingAndConversationState`, `buildBuyerStartFreshReply`, `isBuyerStartCommand` |
| `backend/src/services/buyer/buyerSession.util.ts` | **CREATE** — `computeHasPriorOutbound(history)`, `loadConversationHistory(conversationId, limit=30)` |
| `backend/src/tests/unit/buyerSession.util.test.ts` | **CREATE** |
| `backend/src/tests/unit/buyerQualification.service.test.ts` | Extend rapport/returning cases |

---

## 3. READ-ONLY / CALLERS

- **Callers:** `whatsappTurnOrchestrator.service.ts` (Chunk 03–04 will import `buyerSession.util`)
- **Do not edit orchestrator in this chunk**

---

## 4. Algorithm — hasPriorOutbound (full.md §II.1)

```typescript
export function computeHasPriorOutbound(
  history: Array<{ senderType: string }>,
): boolean {
  return history.some((m) => m.senderType === 'ai' || m.senderType === 'agent');
}
```

**History window:** last **30** messages (full.md). Implement in `loadConversationHistory`.

---

## 5. Session class table (implement as typed enum + doc)

| Class | hasPriorOutbound | Inbound example | Expected handler (verified in Chunk 04) |
|-------|------------------|-----------------|----------------------------------------|
| 1st conversation | false | `Hi` | H2 full welcome + buttons |
| 2nd+ greeting | true | `Hi` | H2 returning, **no buttons** |
| Returning pivot | true | `Something new` | H2b → qualify |
| Continued thread | true | budget text | H4/H9 |
| Fresh restart | any | `/start` | H-start |

---

## 6. isBuyerRapportMessage gate (full.md §II.4)

**Must NOT match when `EXPLICIT_INTENT` regex hits** (price, book, visit, brochure, human, call me).

**Bare greeting + hasPriorOutbound:** still returns true (triggers returning path inside H2).

---

## 7. /start reset scope (full.md §II.5 + PART III H-start)

`resetBuyerBookingAndConversationState` must cancel:
- Pending visit approvals (`bookingApproval.service`)
- Pending/active call requests for lead
- `conversation.stage → rapport`, clear `selectedPropertyId`, `proposedVisitTime`, `recommendedPropertyIds`
- Re-enable `aiEnabled=true`, `status=ai_active`

**Do not** delete lead row or message history.

---

## 8. REMOVE

- Duplicate `history.some(...)` inline in orchestrator **only when Chunk 04 runs** — in Chunk 02, add util; orchestrator still unchanged until Chunk 04 imports it.

---

## 9. If it breaks

| Symptom | Cause |
|---------|-------|
| First `Hi` gets welcome-back | hasPriorOutbound true incorrectly (staff message counted?) |
| Returning buyer gets filter buttons | `isReturningGreeting` not passed to button policy |
| `/start` leaves pending visit | reset service incomplete |

---

## 10. Verification

```bash
npm test -- --testPathPattern="buyerSession|buyerQualification|buyerStartFresh"
```

E2E after Chunk 04: `buyer-01-rapport`, `/start` scenario in PART XVIII.

---

## Next: [chunk-03.md](./chunk-03.md)
