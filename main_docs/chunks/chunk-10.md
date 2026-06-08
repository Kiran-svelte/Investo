# Chunk 10 — Visit Approval + Lifecycle + Reminders (PART V + X visit jobs)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | 10 | full.md **PART V** agent approve + **PART X** visit_reminder_* |

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `visitPendingApproval.service.ts` | create, approve, decline, TTL, agent interactive |
| `bookingApproval.service.ts` | shared approval row + idempotency keys |
| `visitBooking.service.ts` | `scheduleVisit`, conflict check, idempotency |
| `visitState.service.ts` | confirm, reschedule, markVisitAttended, markVisitNoShow |
| `visitLifecycle.service.ts` | `scheduleVisitReminderJobs`, reconcile orphans |
| `utils/visitFormat.util.ts` | buyer/agent message templates |

---

## 3. Agent approve algorithm

```
tryHandleVisitApprovalInteractive(visit-approve-{id})
→ resolve pending BookingApprovalRow
→ scheduleVisit OR confirmVisitById
→ transitionLeadToVisitScheduled
→ scheduleVisitReminderJobs (24h + 1h customer WhatsApp)
→ agentReminderSent cron (~15m) via automation
→ emit visit:updated, lead:updated
→ WhatsApp confirm to buyer formatBuyerVisitScheduled
```

---

## 4. Pending TTL (4h)

`booking_approval_expire` job → auto-decline + notify buyer (PART X).

---

## 5. autoConfirmVisits flag (PART XIV)

When `ai_settings.autoConfirmVisits === true`: skip pending, direct confirm. **Default false.**

---

## 6. markVisitAttended (PART V §8.8)

Must schedule `visit_post_follow_up` ~24h — moved from REST-only path.

---

## 7. REMOVE

- automation.service `processVisitReminders` polling that double-fires customer reminders (System B disabled — only visitLifecycle queue)

---

## 8. Verification

Manual: agent Confirm on WhatsApp → buyer confirm + reminders queued

---

## Next: [chunk-11.md](./chunk-11.md)
