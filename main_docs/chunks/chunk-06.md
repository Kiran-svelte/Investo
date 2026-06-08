# Chunk 06 — Visit Commit Path (H6, H7, H7b, H8 + customerVisitBooking)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | 06 | full.md **PART III** H6–H8 + **PART V** Visit Mega-Tree |

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `customerVisitBooking.service.ts` | `tryCommitCustomerVisitBooking`, `tryCustomerVisitCancelReschedule`, all commit modes |
| `whatsappTurnOrchestrator.service.ts` | `handleVisitCommitWorkflowTurn`, `handleClassifierWorkflowTurn` (visit wf only), H7b inline block, `handleVisitCommitReplyTurn`, `isVisitActionRequest` |
| `visitIntentFromMessage.service.ts` | Parsers — align with full.md text commit paths |
| `visitMutationFromChat.service.ts` | Cancel/reschedule mutations |
| `tests/unit/customerVisitBooking*.test.ts` | extend |

**Do not edit** `visitPendingApproval.service.ts` (Chunk 10) or interactive `handleVisitTimeSlot` (Chunk 08).

---

## 3. tryCommitCustomerVisitBooking algorithm (full.md PART V)

```
1. IF cancel/reschedule intent → tryCustomerVisitCancelReschedule
2. IF pending approval exists → update/cancel pending paths
3. Parse propertyId via resolveBuyerPropertyReference
4. Parse scheduledAt via chrono + history + proposedVisitTime (refresh from DB)
5. IF autoConfirmVisits=false (default) → submitBuyerVisitApproval → mode pending_approval
6. IF autoConfirmVisits=true → scheduleVisit direct → mode scheduled
7. Return { committed, mode, customerReply, workflowSuggestion? }
```

**Modes:** `pending_approval | scheduled | rescheduled | cancelled | already_booked`

---

## 4. Handler wiring

| Handler | Trigger |
|---------|---------|
| H6 | `visitCommit.workflowSuggestion` → `runWorkflow(suggestedId)` |
| H7 | `classifyAndRunBuyerWorkflow` — skip if committed or interactive |
| H7b | `isVisitActionRequest && !visitCommit.committed` → ask datetime template |
| H8 | `visitCommit.committed && customerReply` → persist stage/lead + log `customerVisitBooked` |

---

## 5. REMOVE

- Creating `visits` row with `status=sent` before Meta confirm (outbound Chunk 11)
- Auto `visit_scheduled` lead status on **pending** approval (full.md: stay contacted until agent confirms)
- LLM-only visit booking without `tryCommitCustomerVisitBooking` first

---

## 6. If it breaks

| Symptom | Cause |
|---------|-------|
| "Visit scheduled" but no visit row | Pending path mislabeled as scheduled |
| Reschedule books duplicate | Missing cancelVisitSlot in workflow |
| Bare "book visit" → escalation | H7b not firing before H9 |

---

## 7. Verification

E2E: `buyer-06-book`, `buyer-07-idempotent`, `buyer-int-book-visit` (after Chunk 08)

---

## Next: [chunk-07.md](./chunk-07.md)
