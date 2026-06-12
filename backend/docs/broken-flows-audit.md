# Investo Broken Flows Audit & Implementation Plan

> Living doc — reference before each fix slice. Last updated: 2026-06-12.

## P0 — In progress

| ID | Flow | Symptom | Root cause | Fix | Status |
|----|------|---------|------------|-----|--------|
| F-01 | Staff attendance **Reschedule** button | Agent told to type manual command; customer never asked | `agent-router` expires pending action, no customer outreach | `attendanceReschedule.service.ts` → ask customer → auto-reschedule on reply | **Implementing** |
| F-02 | Visit reschedule reminders | Old 24h/1h reminders fire after reschedule | `rescheduleVisitById` only reschedules jobs when status=`confirmed` | Always `rescheduleVisitReminderJobs` for scheduled+confirmed | **Implementing** |

## P1 — Next

| ID | Flow | Symptom | Fix target |
|----|------|---------|------------|
| F-03 | Staff attendance **No** | Works but customer reschedule is passive | Already sends invite; ensure buyer AI picks up slot | `customerVisitBooking` + metadata |
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
