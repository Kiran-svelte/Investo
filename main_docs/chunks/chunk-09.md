# Chunk 09 — Call Booking Module (PART VI)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | 09 | full.md **PART VI** Call Mega-Tree |

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `callRequest.service.ts` | schedule, approve, decline, cancel, reminders, agent WhatsApp buttons |
| `customerCallBooking.service.ts` | `tryCommitCustomerCallBooking` text path |
| `conversationCallContext.util.ts` | `setConversationAwaitingCallTime`, `isConversationAwaitingCallTime` |
| `utils/callIntentFromMessage.util.ts` | `resolveCallScheduledAt` |
| `whatsappTurnOrchestrator.service.ts` | **`handleCallCommitReplyTurn` only** |
| `tests/unit/callRequest*.test.ts` | extend |

---

## 3. Flow algorithm

```
ENTRY: call-me button | text "call me" | awaitingCallTime reply
→ scheduleCallRequest (Redis idempotency 120s)
→ status pending_approval
→ agent call-approve-{id} / call-decline-{id} on staff WhatsApp
→ confirmed → schedule call_reminder_1h if >70min
→ socket call:created / call:updated
```

---

## 4. handleCallMe branches (PART IV)

| Branch | Client message |
|--------|----------------|
| schedule success | formatBuyerCallReply + call-reschedule/cancel buttons |
| schedule fail | ask for time → awaitingCallTime |
| cancel pending | cancelCallRequest |
| cancel confirmed | notify agent, cannot auto-cancel |

---

## 5. REMOVE

- Raw SQL CREATE TABLE for call_requests (must be Prisma — already migrated in schema chunk)
- Duplicate call scheduling from H9 without tryCommitCustomerCallBooking

---

## 6. Verification

E2E: `buyer-int-call-me`

---

## Next: [chunk-10.md](./chunk-10.md)
