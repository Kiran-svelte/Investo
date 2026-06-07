# Investo — AI Agent Flow (incl. Zero-UI)

| Field | Value |
|-------|-------|
| Document | AI Agent Flow — surfaces, pipelines, Zero-UI |
| Scope | Buyer WhatsApp AI, Staff WhatsApp copilot, Dashboard copilot, automation, import, LangGraph |
| Source | `inboundWhatsAppRouting.service.ts`, `whatsapp.service.ts`, `whatsappTurnOrchestrator.service.ts`, `ai.service.ts`, `agent-router.service.ts`, `conversationStateMachine.ts` |
| Last updated | 2026-06-07 |

> Investo is **not one bot**. It is a set of bounded **AI Surfaces** sharing one database, each with its own pipeline, guards, and channel. The defining trait for end customers is **Zero-UI**: buyers transact entirely through WhatsApp — no login, no forms, no dashboard. Staff can also run daily CRM work Zero-UI through a WhatsApp copilot.

---

## 1. The six AI Surfaces

| # | Surface | Users | Channel | Agentic engine | Mutates CRM? |
|---|---------|-------|---------|----------------|--------------|
| 1 | **Buyer WhatsApp AI** | Prospects (unknown phones) | WhatsApp | Policy FSM + LLM + RAG + workflows | Yes (guarded) |
| 2 | **Staff WhatsApp Copilot** | sales_agent / company_admin / operations / super_admin / viewer | WhatsApp | Deterministic → workflows → intents → LangGraph | Yes (with confirmations; viewer read-only) |
| 3 | **Dashboard Copilot** | Browser staff | Web | `POST /api/copilot/chat` → same backend as WhatsApp copilot | Yes |
| 4 | **Proactive automation** | System | Cron/queue | Templates (+ memory-aware, Phase G) | Yes (templated) |
| 5 | **Property import AI** | Admins | Dashboard upload | Vision/text extraction | Creates drafts |
| 6 | **LangGraph staff agent** | Fallback inside copilot | WhatsApp/web | Tool-calling LLM | Yes (role-scoped) |

Only **#1 and #2** are full conversational WhatsApp agentic paths. The **Cursor dev agent is not an Investo surface** — it edits the code that defines them.

---

## 2. Zero-UI — what it means

### 2.1 Zero-UI for buyers
The buyer journey is **WhatsApp-only**. A buyer never needs a `User` account, dashboard login, or `viewer` role.

| Buyer action | Entry point | Auth |
|--------------|-------------|------|
| Chat | WhatsApp webhook (`/api/webhook`) | None (Meta signature / Green API token) |
| Book visit | Interactive reply `visit-time-{propertyId}-{slot}` | Lead phone only |
| Shortlist / filter | WhatsApp interactive lists | Lead phone only |
| Nurture follow-ups | `automation.service` → `sendCompanyTextMessage` | None |

**Buyers never need:** `POST /api/auth/login`, any `/login` or dashboard route, a `User`/`viewer` record. They exist only as `Lead` + `Conversation` + phone; all conversion happens on WhatsApp.

### 2.2 Zero-UI for staff
Sales agents, operations, and admins can run daily CRM from WhatsApp without opening the dashboard. Requirements:
1. Staff **phone** set on the user profile (last-10-digit match routes to copilot, not buyer AI).
2. Agent AI enabled on the backend.
3. AI provider key configured.

What works from WhatsApp: "visits today / tomorrow", "new leads today", lead list/details/notes/status, schedule/complete/cancel visits (with confirmation), send brochures, morning briefings (9am IST cron).

### 2.3 Zero-UI is dynamic (not a fixed phrase list)
Investo does not rely on a trained phrase whitelist. Every inbound message is handled in layers (deterministic CRM mutations first → staff tools → LLM language only), so paraphrases work.

---

## 3. Identity routing — picking a surface

From `inboundWhatsAppRouting.service.ts`:

```
Inbound WhatsApp message
  → resolve tenant by destination WhatsApp number (companyId)
  → match sender phone (last 10 digits) against company users
        ┌─ matches a staff user        → Staff WhatsApp Copilot (agent-router.service.ts)
        ├─ unknown phone               → Buyer WhatsApp AI (whatsapp.service.ts / orchestrator)
        └─ viewer role                 → read-only copilot (no write tools)
```

| Decision | Rule |
|----------|------|
| Who am I talking to? | **Phone number + company scope** decides the pipeline |
| Multi-tenant | Company A never sees Company B data (`companyId` scoping) |
| Role | RBAC gates tools: `sales_agent` vs `viewer` vs `company_admin` |

---

## 4. Buyer WhatsApp AI — full pipeline

```
Meta webhook → ACK 200 immediately
  → handleIncomingMessage()
  → claimInboundMessageFull (DB dedup + Redis lock)        ── duplicate? stop
  → routeCompanyScopedInbound → buyer
  → lead auto-create if new (Lead status=new, Conversation ai_active, stage=rapport)
  → Buyer turn orchestrator (H1–H9 cascade, first match wins):
      H1  Human takeover check        → static handoff, STOP AI (terminal)
      H1b Dismissal acknowledgement
      H2  Rapport/greeting fast-path  (skipped during booking stages)
      H2b Returning-buyer pivot
      H3  Memory recall
      H4  Qualification
      H5  Visit-status query (deterministic)
      H6  Visit-commit workflow       → tryCommitCustomerVisitBooking / call booking
      H7  Classifier workflow         → classifyAndRunBuyerWorkflow (temp 0)
      H8  Visit-commit reply
      H9  Full AI turn                → aiService.generateResponse (policy + LLM + RAG)
  → extractAndPatchLeadMemory() → syncLeadClientMemory (RAG, async)
  → attach contextual quick replies / media (button + media budget)
  → sanitize outbound (no internal IDs / scores / workflow names; banned-phrase filter; safe fallback)
  → enforce ONE primary outbound per turn (claimPrimaryOutboundSend)
  → presence delay (typing) → send via Meta Cloud API
  → agent_action_logs
```

**Buyer workflows (8):** `brochure_request`, `price_inquiry`, `availability_check`, `amenities_question`, `escalate_to_human`, `schedule_visit`, `reschedule_visit`, `cancel_visit`.
**Parallel call-booking path (not a workflow):** `tryCommitCustomerCallBooking` handles *Call Me*, callback reschedule/cancel, and bare time replies when `commitments.awaitingCallTime` is set.

### 4.1 Dual brain
| Brain | File | Role |
|-------|------|------|
| **Policy brain** | `conversationStateMachine.ts` | Deterministic FSM: decides stage + nextAction (continue / advance / handle_objection / bridge_back / escalate / close). The LLM does **not** decide stage. |
| **Language brain** | `ai.service.ts` | Generates the wording, grounded by RAG + approved inventory; temp 0, JSON output, global rules injected. |

### 4.2 Buyer conversation stages
```
rapport → qualify → shortlist → objection_handling → commitment → visit_booking → confirmation
                                       │                                  │
                          (loops on new objection)              → closed_won
   any point: explicit human request / price negotiation / repeated objection → human_escalated
```
Stage regressions are blocked by `isAllowedStageTransition` (no jumping from a booking stage back to early funnel unless the buyer explicitly restarts).

---

## 5. Staff WhatsApp Copilot — full pipeline

```
routeCompanyScopedInbound → copilot role (AgentSession by thread)
  → deterministic CRM phrases     (tryDeterministicAgentCrmReply: visits today/tomorrow, new leads today) — no LLM
  → deterministic visit mutation  (tryDeterministicAgentVisitMutation: cancel/reschedule)
  → workflows                     (classify → execute)
  → intents                       (agent-intent-orchestrator: ~50 intents, classify → extract → execute)
  → LangGraph tool agent          (last resort; tools: cancelVisit, rescheduleVisit, listLeads, sendBrochureToClient, …)
  → destructive action?           → PendingAction (awaiting) → staff replies YES/NO → execute
  → RBAC + company boundary enforced on every tool
  → agent_action_logs (every step)
```

Staff prompt rules (`agent/prompts/system-prompt.ts`):
- WhatsApp formatting — short lines, *bold*, numbered lists.
- **Must call a tool before stating any CRM fact.**
- **Never claim a mutation succeeded without tool confirmation.**
- Destructive actions → pending confirmation flow.
- `viewer` role → read-only (query tools only, no writes).

### 5.1 Sales-agent data scope
- **Leads:** only those `assignedAgentId = agent`.
- **Visits:** `agentId = agent` OR visits on a lead assigned to the agent.

---

## 6. Dashboard Copilot (parity surface)

```
Browser chat UI (/copilot)
  → POST /api/copilot/chat  (authenticate + companyRateLimiter + AI limiters + requireFeature('ai_bot'))
  → handleAgentMessage()  (same backend brain as WhatsApp staff copilot)
  → same tools, RBAC, confirmations, action logs
```
Goal: a staff member gets the same agentic capabilities in the browser as on WhatsApp.

---

## 7. The dynamic layered model (why paraphrases work)

```
Layer 1 — Deterministic CRM mutations (always first for buyers)
   tryCommitCustomerVisitBooking runs BEFORE the LLM
     · cancel / reschedule → applyVisitMutationFromChat → updates Postgres, returns real new slot
     · book / confirm      → schedules visit when a parseable date/time exists (chrono-node)
     · parses the TARGET slot after "reschedule to …" so the cancel clause's date doesn't win

Layer 2 — Staff copilot (tools + deterministic)
   tryDeterministicAgentCrmReply, tryDeterministicAgentVisitMutation, then LangGraph tools

Layer 3 — LLM (language + persuasion, NOT facts)
   Buyer: aiService.generateResponse for open chat
   Safety net: if the message is still a visit change, applyVisitMutationFromChat OVERRIDES
               any LLM text that would wrongly repeat "Visit scheduled"
```

---

## 8. Outbound message contract & interactive elements

### 8.1 One reply per turn
- `beginOutboundTurn` / `claimPrimaryOutboundSend` enforce **at most one** primary text/interactive bubble per inbound `messageId` per customer phone.
- Media (image/PDF/location) is a separate addon; agent notifications go to a different recipient and are allowed.
- All tap-flow handlers return a single `TurnResult`, dispatched only via `sendTurnResult`.

### 8.2 Meta interactive payloads (`metaMessageBuilder.service.ts`)
| Type | Limits |
|------|--------|
| Text | body ≤ 1024 chars |
| Reply buttons | 1–3 buttons; title ≤ 20 chars; id ≤ 256 |
| List | ≤ 10 rows total; button label ≤ 20; section title ≤ 24; row desc ≤ 72 |
| Header / footer | header ≤ 60; footer ≤ 60 |

Buttons appear **only at decision points** (after shortlisting, during booking) and are suppressed for bare greetings.

---

## 9. Guards & safety (production non-negotiables)

| Guard | Mechanism |
|-------|-----------|
| **No false success** | Mutation guard — never say "booked/confirmed" without DB success |
| **No internal leakage** | Sanitizer strips property IDs, match scores, workflow names, signatures |
| **No invented outages** | `safeBuyerFallback.util.ts` — banned-phrase filter blocks "connection issue" etc. |
| **No re-welcome / capability menus mid-chat** | `buyerBannedPhraseFilter.util.ts` |
| **No staff/dashboard language to buyers** | `buyerStaffCopyGuard.util.ts` + sanitizer |
| **Human takeover** | Conversation `agent_active` → AI stops until released (H1 terminal) |
| **Idempotent mutations** | Webhook dedup + idempotency keys → no double booking on retries |
| **Confidence thresholds** | Mutations ≥ 0.80; clarify band logged as `workflow_clarification`; never write DB on clarify |
| **Grounding** | Answers only from approved/published inventory + RAG; temp 0 |
| **Tenant isolation** | `companyId` scoping on every query/tool |
| **RBAC** | Per-role tool access; `viewer` read-only |

---

## 10. Memory flow (unified brain)

```
Read path:   buildPromptMemoryBlock(leadId) / unifiedMemory.service  ── used by buyer AI + staff copilot
Write path:  extractAndPatchLeadMemory (buyer) + patchLeadMemory (staff)
                 → leads.lead_memory (JSONB, single source of truth)
                 → syncLeadClientMemory (async ≤ 60s) → RAG vectors (client_memory_chunks)
```
Conversation stage, live context, and RAG chunks are **derived views**, never competing truths.

---

## 11. Actor × channel × surface matrix

| Actor | Channel | Surface | Can mutate CRM? | Goal |
|-------|---------|---------|-----------------|------|
| Buyer / prospect | WhatsApp | Buyer WhatsApp AI | Yes (guarded) | Qualify → shortlist → **book visit** |
| Sales agent | WhatsApp / web | Staff copilot | Yes (confirmations) | Visits today, notes, no-show, lead queries |
| Company admin | WhatsApp + dashboard | Staff copilot + config | Yes (broader) | Ops, team, settings |
| Operations | WhatsApp / web | Staff copilot | Yes (scoped) | Visit coordination |
| Viewer | WhatsApp / web | Read-only copilot | **No** | Query-only CRM |
| System | Cron/queue | Proactive automation | Yes (templated) | Reminders, follow-ups |
| Admin | Dashboard upload | Property import AI | Drafts only | Ingest brochure/inventory |

---

## 12. End-to-end Zero-UI example (buyer books a visit)

```
Buyer (WhatsApp, Hindi): "Whitefield me 3BHK 1.5cr ke andar?"
  → webhook → dedup → tenant → buyer → lead auto-created (lang=hi, stage rapport→qualify)
  → policy brain: advance to shortlist; language brain queries approved inventory
  → ONE reply (Hindi): 2–3 matches + images + quick buttons [Book Visit | Details | EMI]
Buyer taps "Book Visit"
  → interactive short-circuit → offer time-slot buttons (stage commitment→visit_booking)
Buyer taps a slot (visit-time-{propertyId}-{slot})
  → claimWorkflowExecution(idempotencyKey)  ── duplicate tap → cached reply, no 2nd visit
  → create Visit (scheduled); autoConfirmVisits? confirm : pending-approval to agent
  → ONE confirmation message (+ optional location pin), stage confirmation
  → patch lead_memory (upcomingVisits), action log
System: schedules reminders (24h / 1h / 15min) — all on WhatsApp
```
No login. No form. No app. **That is Zero-UI.**

---

## 13. Key file map

| Concern | Primary files |
|---------|---------------|
| Inbound routing | `inboundWhatsAppRouting.service.ts` |
| Buyer orchestration | `whatsappTurnOrchestrator.service.ts`, `whatsapp.service.ts` |
| Staff copilot | `agent-router.service.ts`, `agent/prompts/system-prompt.ts` |
| Workflows | `workflow-engine.service.ts`, `workflow.constants.ts` |
| Buyer LLM + policy | `ai.service.ts`, `conversationStateMachine.ts`, `realEstateAssistantPrompt.constants.ts` |
| Sanitization & guards | `whatsappResponseSanitizer.service.ts`, `buyerBannedPhraseFilter.util.ts`, `safeBuyerFallback.util.ts`, `buyerStaffCopyGuard.util.ts` |
| Visit/call fast-path | `customerVisitBooking.service.ts`, `customerCallBooking.service.ts`, `visitMutationFromChat.service.ts` |
| Interactive builder | `metaMessageBuilder.service.ts` |
| Memory | `lead-memory.service.ts`, `unifiedMemory.service.ts`, `buyer-memory-extract.service.ts`, `clientMemory.service.ts` |
| Action audit | `agent-action-log.service.ts` |
| Dashboard copilot | `copilot.routes.ts` → `handleAgentMessage` |

---

## 14. One-sentence alignment

**Investo AI Surfaces** = every place intelligence touches users — buyer WhatsApp, staff copilot, dashboard copilot, automation, import, LangGraph — each with its own pipeline, guards, and channel; for buyers (and much of staff work) the channel is **WhatsApp only — Zero-UI**.
