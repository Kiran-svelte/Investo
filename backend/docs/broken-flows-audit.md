# Investo Broken Flows Audit & Implementation Plan

> Living doc — reference before each fix slice. Last updated: 2026-06-12.

## P0 — Latency (F-LAT)

| ID | Issue | Fix | Status |
|----|-------|-----|--------|
| F-LAT-01 | H9 used `replyPacing: full` (+ up to 1.2s artificial delay) | `FEATURE_FAST_WHATSAPP_REPLIES` default ON → pacing `none` | **Done** |
| F-LAT-02 | Buyer LLM timeout 28s | 12s cap + faster fallback | **Done** |
| F-LAT-03 | Sequential visitCommit + liveCtx | `Promise.all` parallel prefetch | **Done** |
| F-LAT-04 | Staff copilot unbounded LLM chain | 18s wall timeout | **Done** |

Kill switch: `FEATURE_FAST_WHATSAPP_REPLIES=false` restores human pacing + 28s LLM cap.
Benchmark: `npm run benchmark:reply-speed`

## P0 — In progress

| ID | Flow | Symptom | Root cause | Fix | Status |
|----|------|---------|------------|-----|--------|
| F-01 | Staff attendance **Reschedule** button | Agent told to type manual command; customer never asked | `agent-router` expires pending action, no customer outreach | `attendanceReschedule.service.ts` → ask customer → auto-reschedule on reply | **Done** (`a69df6c6c`) |
| F-02 | Visit reschedule reminders | Old 24h/1h reminders fire after reschedule | `rescheduleVisitById` only reschedules jobs when status=`confirmed` | Always `rescheduleVisitReminderJobs` for scheduled+confirmed | **Done** |

## P1 — Next

| ID | Flow | Symptom | Fix target |
|----|------|---------|------------|
| F-03 | Staff attendance **No** | Works but customer reschedule is passive | Already sends invite; ensure buyer AI picks up slot | `customerVisitBooking` + metadata |
| F-11 | Staff **check-in / check-out** | No shift greeting or EOD reminder on demand | CHECK IN / CHECK OUT fast path + enhanced cron briefings | `staffShiftBriefing.service.ts` | **Done** |
| F-12 | Agent tool `follow_up_due` | Logged but never fired | `processDueFollowUps` cron every 15 min | `cron-scheduler.service.ts` | **Done** |
| F-04 | Visit approval **Decline** (2 buttons) | Customer gets generic text only | Agent should get reschedule shortcut too | `visitPendingApproval.resolveVisitApproval` |
| F-05 | Post-visit `visit_post_follow_up` cron | Generic nurture, no situational buttons | Wire `buyerSituationButtons` post-visit | `automation.service` + orchestrator |
| F-06 | Agent 15m notification | May duplicate after reschedule | Cancel/re-enqueue on `rescheduleVisitReminderJobs` | `visitLifecycle` + automation queue |
| F-07 | Bulk send phrasing | Inconsistent when LLM omits `message` | Already in prompt; add deterministic parser fallback | `agent-intent-orchestrator` |
| F-08 | Staff phone = buyer lead | Session contamination | Structured collision log (done PR-4); admin alert | notification to company_admin |
| F-09 | Property publish without media | Brochure/image sends fail silently | `customerMedia` completeness (done PR-5) | — |
| F-10 | Copilot viewer write intents | Cryptic failures | Role filter (done PR-4) | — |

## P2 — Backlog

- EOD attendance duplicate sends (cron race with rolling no-show check)
- `bulkUpdateVisits` snooze bypasses `rescheduleVisitReminderJobs`
- Conversation timeout 24h during active visit booking
- Cross-channel follow-up when WhatsApp send fails (email stub only)
- LangGraph augment mode silent fallback to empty reply
- Redis-less automation queue in-memory loss on restart

## Safety nets (every slice)

1. Feature flag default ON (`!== 'false'`)
2. Unit tests for happy path + timezone (IST)
3. `npm run smoke` before deploy
4. Kill switch via Railway env
5. Shadow log old vs new where behavior changes

## Deploy checklist

```powershell
cd backend; npx jest <affected tests> --runInBand
cd backend; npm run smoke
git add <named files only>
git commit -m "..."
git push kiran main
$env:RAILWAY_TOKEN='...'; powershell -File scripts/deploy-railway-backend.ps1
```
