# Zero UI for staff (WhatsApp CRM copilot)

Sales agents, operations, and company admins can run daily CRM work from WhatsApp without opening the dashboard for every task.

## Requirements for "ready"

1. **Staff phone** on the user profile (same number as WhatsApp) — last-10 digit match routes to agent copilot, not buyer AI.
2. **`AGENT_AI_ENABLED`** not `false` on the backend (Render).
3. **OpenAI** (or Anthropic) API key configured for agent model.

## What works from WhatsApp

| Ask | Tool / behavior |
|-----|-----------------|
| Visits today | `listVisitsToday` + deterministic fast path |
| Visits tomorrow / "for tomorrow" | `listVisitsTomorrow` + deterministic fast path |
| New leads today | `listLeadsAddedToday` + deterministic fast path |
| Lead list / details / notes / status | `listLeads`, `getLeadDetails`, `addLeadNote`, etc. |
| Schedule / complete / cancel visits | visit tools (+ confirmations) |
| Brochures to clients | PDF via `sendBrochureToClient` |
| Morning briefings | cron → WhatsApp (9am IST) |

## Sales agent data scope

- **Leads:** assigned to the agent (`assignedAgentId`).
- **Visits:** `agentId` = agent **or** visit on a lead assigned to the agent (fixes visits booked under another agent id).

## Buyer vs staff

- **Buyer** (unknown phone): prospect AI on `/api/webhook` — see `docs/ZERO_UI_BUYER.md`.
- **Staff** (phone on user row): `routeCompanyScopedInbound` → agent copilot.

## Source plan

Extended from the Zero-UI implementation plan (staff pillars: transparency, crons, tools).
