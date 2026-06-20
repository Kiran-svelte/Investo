# Chunk 04 — Visit Booking, Calendar, Reminders & Conversion

| Field | Value |
|-------|-------|
| Chunk | 04 of 7 |
| Pillar | 4 — Visit is the conversion |
| Priority | P0 |
| Depends on | Chunks 01, 03 |
| Unblocks | Chunk 06 (conversion analytics) |

---

## 1. Single-feature scope

**One focus only:** Buyers and staff can **book, confirm, reschedule, and complete site visits** with **calendar visibility**, **automated reminders**, and **honest pipeline status** — the core conversion loop for real-estate agencies.

---

## 2. Current state — NOW

### 2.1 Production today (working)

| Capability | Status | Code / route |
|--------------|--------|--------------|
| Book visit from WhatsApp (buyer workflow) | ✅ | `visitBooking.service`, `workflow-engine` |
| Book from dashboard | ✅ | `visit.routes`, `CalendarPage` |
| Visit statuses (scheduled → confirmed → completed) | ✅ | `visitState.service` |
| Reminder jobs (24h / 1h) | ✅ | `automation.service`, `rescheduleVisitReminderJobs` |
| Agent attendance flow (check-in/out) | ✅ | `staffShiftBriefing.service` |
| Staff reschedule via customer reply | ✅ | `attendanceStaffReschedule.service` (F-01 done) |
| Pending approval (agent confirm/decline) | ✅ | `visitPendingApproval.service` |
| EMI calculator (sales aid) | ✅ | `finance.routes`, `EmiCalculatorPage` |

### 2.2 Test-only / partial / gaps

| Gap | Impact |
|-----|--------|
| Calendar UI lacks visual free/busy grid | Ops mental double-booking risk |
| Multi-visit disambiguation chunks 05–08 | Opt-in flags default OFF |
| Bulk visit snooze may skip reminder reschedule | Stale reminders (P2 backlog) |
| Timezone edge cases in workflow tests | IST vs UTC failures in CI |
| Visit approval decline → weak customer follow-up | F-04 backlog |

### 2.3 User experience TODAY

| Persona | Experience |
|---------|------------|
| **Buyer** | "Book visit Saturday 11am" → approval-first or instant confirm per tenant settings → reminders on WhatsApp. |
| **Agent** | Calendar lists visits; WhatsApp nudges for today's schedule; attendance buttons on staff channel. |
| **Admin** | Sees all visits; can reassign via dashboard. |
| **Operations** | Calendar + visit status updates; no Gantt/grid view. |

---

## 3. Target state — AFTER

### 3.1 Perfect functioning

- Double-booking **prevented** at API level for same agent overlapping slots.
- Reschedule **always** cancels old reminder jobs and schedules new ones.
- Buyer with 2 upcoming visits asked "cancel" → disambiguation buttons (Chunk flags on).
- Visit completed → lead status auto-advances + post-visit nurture with situational buttons.
- Calendar p95 load < 1.5s for 30-day window.

### 3.2 User experience AFTER

| Persona | After fix |
|---------|-----------|
| **Buyer** | Clear confirm message with address/map pin; one-tap reschedule. |
| **Agent** | Morning briefing on WhatsApp + dashboard; no duplicate reminders after reschedule. |
| **Admin** | Calendar grid shows agent columns (optional later) or conflict warnings inline. |

---

## 4. Implementation plan

### Phase 1 — Reminder integrity (week 1)

| Task | Files |
|------|-------|
| Reschedule always updates jobs | `visitLifecycle`, `rescheduleVisitReminderJobs` |
| Decline flow customer outreach | `visitPendingApproval.service` (F-04) |
| IST timezone normalization tests | `workflow-engine.service.test.ts` fixes |

### Phase 2 — Multi-visit UX (week 2)

| Task | Files |
|------|-------|
| Enable `FEATURE_VISIT_DISAMBIGUATION` | `workflow-engine`, `buyerSituationButtons` |
| Enable `FEATURE_MULTI_VISIT_CONTEXT` | `liveLeadContext.service` |
| Second visit policy (different project) | `FEATURE_SECOND_VISIT_POLICY` |

### Phase 3 — Calendar product (week 3)

| Task | Files |
|------|-------|
| Conflict detection API | `calendar.routes.ts` |
| Calendar UI conflict badges | `CalendarPage.tsx` |
| Post-visit automation + buttons | `automation.service`, F-05 |

---

## 5. Enterprise hardening

| Control | Requirement |
|---------|-------------|
| Tenant isolation | Visits scoped by `companyId` + lead ownership |
| Audit | `visit.booked`, `visit.rescheduled`, `visit.completed` |
| Idempotency | Webhook dedup on visit book intents |
| SLA | Webhook ack p95 < 200ms (async path) |
| Approval chains | `FEATURE_APPROVAL_CHAINS` for enterprise visit sign-off |

**Kill switch:** `visit_scheduling` tenant feature off disables booking UI + buyer workflows gracefully.

---

## 6. Real-time usage scenarios

```
Buyer: "Visit tomorrow 4pm at Green County"
  → NLP datetime (IST) → bookVisit tool → pending approval
Agent gets WhatsApp: Approve / Decline / Reschedule
  → Approve → buyer confirm + calendar row + reminder jobs enqueued
T-24h: WhatsApp reminder to buyer
T-1h: second reminder + agent nudge
Visit day: staff CHECK IN → buyer "your agent is on the way" (if configured)
Post-visit: automation follow-up + "Rate experience" buttons
```

---

## 7. Tests & proof gates

| Gate | Command |
|------|---------|
| Visit booking unit | `npx jest src/tests/unit/customerVisitBooking.test.ts` |
| Visit state | `npx jest src/tests/unit/visitState.service.test.ts` |
| Pending approval | `npx jest src/tests/unit/visitPendingApproval.service.test.ts` |
| Production proof | `backend/scripts/proof-visit-bulk-production.mjs` |
| Handset | `e2e-handset-proof.mjs` — full book → confirm path |
| Smoke | `GET /visits` 200, `GET /calendar` endpoints |

---

## 8. Feature flags & env

| Flag | Purpose |
|------|---------|
| `visit_scheduling` (tenant) | Module access |
| `FEATURE_ATTENDANCE_STAFF_RESCHEDULE` | F-01 flow |
| `FEATURE_VISIT_DISAMBIGUATION` | Multi-visit clarify |
| `FEATURE_MULTI_VISIT_CONTEXT` | Context registry |
| `WHATSAPP_*` | Per-tenant Meta creds |

---

## 9. Definition of done

- [ ] Book → approve → reminder → complete on production handset (1 full cycle)
- [ ] Reschedule cancels old reminders (verify job IDs in logs)
- [ ] No double-book same agent same slot (API 409)
- [ ] Lead status `visited` after completion
- [ ] Production smoke: visits + calendar 200

---

## 10. Rollout

1. Enable multi-visit flags on one high-traffic tenant
2. Monitor reminder delivery in Meta message logs 72h
3. Roll flags to 100% `FEATURE_ROLLOUT_PERCENTAGE` after zero escalation week
