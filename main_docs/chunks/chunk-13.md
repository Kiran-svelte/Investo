# Chunk 13 — Automation Jobs (PART X)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | 13 | full.md **PART X** — 14 job types |

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `automation.service.ts` | `enqueueJob`, `executeQueuedJob`, `processFollowUpRules`, `processVisitReminders` (agent 15m only) |
| `automationQueue.service.ts` | schedule/cancel/dedupe keys |
| `cron-scheduler.service.ts` | Agent visit reminders — **agentReminderSent flag only** |
| `opsMetrics.service.ts` | `recordDailyOpsRollup` cron schedule if missing |

---

## 3. Job catalog (implement handlers)

| Job type | Trigger | Recipient |
|----------|---------|-----------|
| visit_reminder_24h | visitLifecycle on confirm | Customer WhatsApp |
| visit_reminder_1h | visitLifecycle | Customer WhatsApp |
| visit_agent_notification_15m | automation scan confirmed visits | Agent in-app |
| call_reminder_1h | call confirm | Customer WhatsApp |
| lead_follow_up_48h | contacted idle 48h | Customer |
| lead_follow_up_7d | negotiation stale | Customer |
| lead_nurture_3d/7d/30d | re-engagement rules | Customer |
| visit_post_follow_up | markVisitAttended +24h | Customer |
| conversation_timeout_24h | idle conversation | optional close |
| booking_approval_agent_nudge | pending >1h | Agent |
| booking_approval_expire | pending >4h | auto-decline + customer |
| retry_concurrent_inbound | Chunk 01 queue fail | replay webhook payload |

---

## 4. REMOVE

- Customer visit reminder polling in automation.service that shares `reminderSent` with visitLifecycle (System B)

---

## 5. Verification

Integration: confirm visit → jobs visible in automation_queue table / Redis

---

## Next: [chunk-14.md](./chunk-14.md)
