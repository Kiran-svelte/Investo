# Chunk 08 — Interactive Orchestrator (PART IV + XV)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | 08 | full.md **PART IV**, **PART XV** (33 interactive IDs) |

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `whatsappInteractiveOrchestrator.service.ts` | All `handle*` functions, `routeInteractiveAction`, `persistInteractiveAiTranscript`, `buildVisitSlotButtons` |
| `whatsappInteractivePersist.service.ts` | `applyInteractiveActionSideEffects` |
| `whatsapp.service.ts` | **`handleInteractiveAction` method only** — delegate to orchestrator, legacy `prop-`, `location-`, `emi-calculator` shims |
| `tests/unit/whatsappInteractiveOrchestrator.test.ts`, `interactive-buttons.test.ts` | extend |

---

## 3. Route table (must match PART XV)

| interactiveId | Handler | action code |
|---------------|---------|-------------|
| `visit-confirm` | handleVisitConfirm | visit-confirmed |
| `visit-reschedule` | handleVisitReschedule | visit-reschedule-initiated |
| `visit-time-{pid}-{slot}` | handleVisitTimeSlot | visit-pending-agent-approval |
| `book-visit*` | handleBookVisit | book-visit-initiated |
| `visit-slot-morning/afternoon` | handleGenericVisitSlot | → book-visit-{selectedPropertyId} |
| `call-me`, `callback-request` | handleCallMe | callback-requested |
| `call-cancel` | handleCallCancel | callback-cancelled |
| `call-reschedule` | handleCallReschedule | callback-reschedule-prompt |
| `more-info*` | handleMoreInfo | more-info-sent |
| `filter-*` | handlePropertyFilter | filter-applied / filter-no-results-alternatives |

---

## 4. handleVisitTimeSlot algorithm (PART V interactive)

```
parseVisitTimeInteractiveId → resolveVisitSlotToDate (IST)
IF no property → visit-property-unavailable
IF no agent → assignLeadRoundRobin
IF existing confirmed visit → notifyAgentVisitChangeRequested (no auto change)
ELSE createVisitApprovalRequest(suppressCustomerMessage=true)
RETURN formatBuyerVisitPendingApproval(agentName)
```

**Default path is pending approval** — not direct scheduleVisit (dead code block with `if (false)` stays removed).

---

## 5. handlePropertyFilter edge cases

| Branch | Behavior |
|--------|----------|
| Duplicate filter within 30s | Return last AI content (`filter-duplicate-prevented`) |
| Zero results | `searchAlternativeTiers` + waitlist commitments |
| Success | WhatsApp list rows `prop-{id}` max 10 |

---

## 6. persistInteractiveAiTranscript

Idempotent within **15s** same content — fixes E2E `aiCount=0` if missing.

---

## 7. REMOVE

- Duplicate interactive handling inside H9/LLM
- Direct `scheduleVisit` on button tap without approval (unless autoConfirmVisits flag checked in Chunk 10 service)

---

## 8. Verification

E2E: `buyer-int-filter`, `buyer-int-more-info`, `buyer-int-call-me`, `buyer-int-book-visit` → **must reach aiCount≥1**

---

## Next: [chunk-09.md](./chunk-09.md)
