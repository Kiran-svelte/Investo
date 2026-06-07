# Investo AI — Complete Reality Check, Ideal State & Roadmap

> **Purpose:** Single source of truth for what Investo AI does today, where it falls short, how it should work, and exactly what to build next.  
> **Audience:** Engineering, product, ops.  
> **Related docs:** [`ai.md`](./ai.md) (ideal behavior), [`ai-implementation-plan.md`](./ai-implementation-plan.md) (technical gap tracker)  
> **Last updated:** 2026-06-06

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [What exists today (full map)](#2-what-exists-today-full-map)
3. [Buyer WhatsApp pipeline](#3-buyer-whatsapp-pipeline)
4. [Staff WhatsApp copilot pipeline](#4-staff-whatsapp-copilot-pipeline)
5. [Dashboard & other AI surfaces](#5-dashboard--other-ai-surfaces)
6. [Intent recognition (5 classifiers)](#6-intent-recognition-5-classifiers)
7. [Memory (8 stores)](#7-memory-8-stores)
8. [Reliability & idempotency](#8-reliability--idempotency)
9. [Gap scorecard](#9-gap-scorecard)
10. [How it should work (target state)](#10-how-it-should-work-target-state)
11. [How to fix each gap](#11-how-to-fix-each-gap)
12. [Sprint roadmap (1–2 sprints)](#12-sprint-roadmap-12-sprints)
13. [Phased plan (full journey)](#13-phased-plan-full-journey)
14. [Implementation checklists](#14-implementation-checklists)
15. [Acceptance test matrix](#15-acceptance-test-matrix)
16. [File touch map](#16-file-touch-map)

---

## 1. Executive summary

Investo AI is **not one agent**. It is **six surfaces** sharing databases and services:

| # | Surface | Users | AI type |
|---|---------|-------|---------|
| 1 | **Buyer WhatsApp AI** | Prospects (unknown phones) | Policy brain + LLM + workflows |
| 2 | **Staff WhatsApp Copilot** | Sales / admin / ops on registered phones | Deterministic + workflows + intents + LangGraph |
| 3 | **Dashboard** | Humans in browser | **No AI chat** — config, monitor, manual CRM |
| 4 | **Proactive automation** | System | Templates + DB (cron + queue) |
| 5 | **Property import AI** | Admins | GPT Vision / text extraction |
| 6 | **LangGraph staff agent** | Fallback in copilot | Tool-calling LLM |

**Key truths:**

- Staff AI lives on **WhatsApp**, not in the dashboard browser.
- Buyer AI has strong visit/state handling but **weak memory write-back** after each turn.
- Memory is split across **8 stores** that are not always in sync.
- `agent_action_logs` exist for transparency but have **no dashboard UI**.
- Workflow saga/compensators are **started** but not fully atomic end-to-end.

---

## 2. What exists today (full map)

### Entry point (all WhatsApp)

```
Meta / GreenAPI webhook
  → res.sendStatus(200) immediately
  → whatsappService.handleIncomingMessage()
      → claimInboundMessageFull (DB + Redis dedup)
      → routeCompanyScopedInbound (identity)
          ├─ Staff copilot roles → agent-router.service.ts
          ├─ Other staff → static "use dashboard"
          └─ Unknown phone → buyer pipeline
```

### Key files

| Area | File |
|------|------|
| Webhook ingress | `backend/src/routes/webhook.routes.ts`, `greenapi-webhook.routes.ts` |
| Identity routing | `backend/src/services/inboundWhatsAppRouting.service.ts` |
| Buyer pipeline | `backend/src/services/whatsapp.service.ts` |
| Staff copilot | `backend/src/services/agent/agent-router.service.ts` |
| Workflow engine | `backend/src/services/workflow/workflow-engine.service.ts` |
| Action handlers (45) | `backend/src/services/workflow/actions/index.ts` |
| Workflow catalog (15) | `backend/src/services/workflow/workflow-catalog.util.ts` |
| Lead memory | `backend/src/services/lead-memory.service.ts` |
| Context summary | `backend/src/services/conversation-summary.service.ts` |
| Client memory RAG | `backend/src/services/clientMemory.service.ts` |
| Buyer AI (dual brain) | `backend/src/services/ai.service.ts` |
| Policy / stages | `backend/src/services/conversationStateMachine.ts` |
| Inbound dedup | `backend/src/services/inboundMessageGuard.service.ts` |
| Action audit log | `backend/src/services/agent-action-log.service.ts` |
| Saga compensators | `backend/src/services/workflow/workflow-compensator.service.ts` |
| Capability map | `backend/src/constants/ai-capabilities.constants.ts` |

### Identity split

| Sender phone | Route |
|--------------|-------|
| Not on company `users` table | **Buyer** — full prospect AI |
| `super_admin`, `company_admin`, `sales_agent`, `operations` | **Investo Copilot** |
| Other staff (e.g. `viewer`) | Static “use dashboard” message |

### Kill switches (`config.agentAi`)

| Env var | Effect |
|---------|--------|
| `AGENT_AI_ENABLED=false` | Master off for staff stack |
| `AGENT_AI_COPILOT_ENABLED=false` | Staff get “use dashboard” on WhatsApp |
| `AGENT_AI_LLM_ENABLED=false` | Deterministic CRM still works; no LLM classifiers/graph |
| `AGENT_AI_CRON_ENABLED=false` | No proactive WhatsApp cron to staff |

Buyer AI has no equivalent master kill — it runs when WhatsApp is connected and sender is a prospect.

---

## 3. Buyer WhatsApp pipeline

### Strict order of operations

```
1. Interactive buttons (only if conversation.status = ai_active)
2. ensureProspectConversationAiActive()  ← re-enables AI on inbound
3. tryCommitCustomerVisitBooking()       ← visit fast-path
4. visitCommit.workflowSuggestion → runWorkflow OR classifyAndRunBuyerWorkflow()
5. Deterministic visit-status query (no LLM)
6. aiService.generateResponse()          ← policy brain + language brain + RAG
7. Contextual quick replies, filters, media, brochures
```

### Buyer workflows (8 of 15)

`brochure_request`, `price_inquiry`, `availability_check`, `amenities_question`, `escalate_to_human`, `schedule_visit`, `reschedule_visit`, `cancel_visit`

Staff-only workflows: `new_lead`, `update_status`, `add_note`, `assign_agent`, `complete_visit`, `mark_visit_outcome`, `agent_availability`.

### Conversation stages (policy brain)

`rapport` → `qualify` → `shortlist` → `objection_handling` → `commitment` → `visit_booking` → `confirmation` → `human_escalated` → `closed_won` / `closed_lost`

The **policy brain** (`classifyMessageIntent`) decides stage transitions **before** the LLM writes text.

### Critical behavior: dashboard takeover is not sticky

When a prospect texts again, `ensureProspectConversationAiActive()` flips `agent_active` → `ai_active` and turns AI back on. A human who took over in the dashboard does **not** permanently block buyer AI on the next inbound message.

Escalation from AI (`human_escalated`) sets `agent_active` + `aiEnabled: false`, but the next customer message still re-enables AI (to avoid “stuck on specialist will assist”).

---

## 4. Staff WhatsApp copilot pipeline

### Strict order of operations

```
1. Greeting / help (deterministic)
2. Pending YES/NO confirmations (destructive actions)
3. tryDeterministicAgentCrmReply (regex fast paths)
4. classifyAndRunWorkflow (15 workflows, tiered confidence)
5. classifyAndExecuteAgentIntent (58 intents, threshold 0.55)
6. invokeAgent (LangGraph + role-scoped tools)
7. Fallback help menu
```

### Staff intents (58)

Includes CRM mirror of dashboard: `takeover_conversation`, `release_conversation`, `send_message_to_client`, `update_lead_status`, `get_dashboard_stats`, `get_ai_action_log`, etc.

### LangGraph agent (last resort)

- Provider: OpenAI or Anthropic (`AGENT_AI_PROVIDER`)
- Postgres checkpointer for thread state
- Role-scoped tools (~30+ by role)
- Max 10 tool calls per message; 20-message sliding window

---

## 5. Dashboard & other AI surfaces

### Dashboard — what exists (no AI chat)

| Page | AI? | What happens |
|------|-----|--------------|
| **Conversations** | No LLM | Watch threads, takeover, release, send text/doc/quick-reply |
| **Leads / Visits / Calendar** | No LLM | Standard CRUD |
| **AI Settings** | Config only | Tone, language, FAQ, company brain, Never-Say-No |
| **Property Import** | Yes (GPT) | Brochure/PDF/image extraction |
| **Analytics** | No LLM | Charts from DB |

### Dashboard vs WhatsApp copilot

| Action | Dashboard | WhatsApp Copilot |
|--------|-----------|------------------|
| Takeover conversation | `PATCH /conversations/:id/takeover` | Intent / tool `takeoverConversation` |
| Release to AI | `PATCH /conversations/:id/release` | Intent `release_conversation` |
| Send message to client | Conversations UI | Intent `send_message_to_client` |
| View AI action log | **No UI** | Intent `get_ai_action_log` (admin, WhatsApp only) |

### Proactive automation (not conversational AI)

**`automation.service`:** visit reminders 24h/1h, follow-ups, conversation timeout, workflow reconciliation.

**`cron-scheduler.service`:** morning briefings, EOD summaries, hot-lead SLA, no-show detection, EOD attendance check, weekly/monthly reports, action log purge.

Almost all proactive messages are **templates + DB queries**, not LLM-generated.

### Property import AI

`propertyImportExtractor.service.ts` — GPT Vision / text for brochure extraction. Dashboard-only; does not affect live WhatsApp conversations.

---

## 6. Intent recognition (5 classifiers)

Investo does **not** have one intent system. It has five layers:

| # | Classifier | Type | Threshold | Used by |
|---|------------|------|-----------|---------|
| A | `classifyMessageIntent` | Regex/rules | N/A | Buyer policy brain (stages) |
| B | `classifyWorkflowMessage` | LLM (temp 0.05) | 0.62 / 0.75 mutations | Buyer + staff workflows |
| C | `classifyAgentIntent` | LLM | 0.55 | Staff intent orchestrator |
| D | Visit fast-path | Deterministic | N/A | `tryCommitCustomerVisitBooking` |
| E | Deterministic CRM | Regex | N/A | `tryDeterministicAgentCrmReply`, shortcuts |

**Mutation workflows** (`schedule_visit`, `reschedule_visit`, `cancel_visit`):

- Execute if confidence ≥ **0.75**
- Clarification band **0.65–0.75** → ask “book new or change existing?”
- Below 0.65 → fall through to fast-path / main AI

**Edge case example:** “push my visit” with active visit may still misclassify as `schedule_visit` instead of `reschedule_visit` when confidence is borderline.

---

## 7. Memory (8 stores)

| Store | Location | Who reads | Who writes | Sync quality |
|-------|----------|-----------|------------|--------------|
| Lead DB fields | `leads` table | Everyone | Forms, workflows, AI extraction | Good |
| Lead memory JSON | `leads.lead_memory` | Buyer + staff prompts | `patchLeadMemory` (staff, lead-actions) | **Buyer rarely writes** |
| Client memory RAG | `client_memory_chunks` | Buyer + staff LLM | `syncLeadClientMemory` on messages | Eventual |
| Conversation state | `conversations` stage/commitments | Buyer policy brain | Every buyer turn | Good |
| Live lead context | `liveLeadContext.service` | All buyer paths | DB read (visits, agent) | Good |
| Rolling context | `conversation-summary.service` | Buyer AI | Built on read | Good |
| Staff session | `agent_sessions` + last 5 msgs | Staff copilot | Each copilot exchange | Good |
| LangGraph checkpoint | Postgres | Staff graph only | Per thread | Good |

### Target (`ai.md` ideal)

One canonical blob per lead:

```json
{
  "version": 1,
  "updatedAt": "2026-06-06T12:00:00Z",
  "projectsDiscussed": [{ "propertyId", "name", "factsShown": ["price", "amenities"] }],
  "budget": { "min", "max", "currency": "INR" },
  "locationPreference": "Whitefield",
  "upcomingVisits": [{ "visitId", "propertyName", "scheduledAt", "status" }],
  "lastIntent": "reschedule_visit",
  "conversationSummary": "Booked Lake Vista Saturday 4pm; now wants Sunday.",
  "openQuestions": []
}
```

**Today:** `lead-memory.service.ts` implements this shape, but buyer path **reads** more than it **writes**. Vector RAG and structured memory can disagree.

---

## 8. Reliability & idempotency

| Layer | Status |
|-------|--------|
| Webhook 200-first | ✅ Shipped |
| Inbound `message_id` dedup (DB) | ✅ Shipped |
| Customer fingerprint + processing lock | ✅ Shipped |
| Outbound reply dedup | ✅ Shipped |
| Workflow idempotency (schedule/reschedule/cancel) | ✅ Redis + DB |
| `WorkflowRunRecord` + step tracking | ✅ Shipped |
| Compensators (`workflow-compensator.service.ts`) | ⚠️ Partial — not fully atomic |
| Reconciliation cron | ✅ `automation.service.reconcileWorkflowRuns` |
| Automation per-recipient locks | ✅ Shipped |

---

## 9. Gap scorecard

| Gap | Reality | Impact | Grade |
|-----|---------|--------|-------|
| **Unified memory** | 8 stores; not always in sync | AI repeats questions; weak continuity | **C+** |
| **Workflow rollback** | Compensators exist; full saga imperfect | Partial failure → inconsistent state (visit booked, no confirmation) | **B-** |
| **Buyer memory write** | Buyer reads `lead_memory`; rarely writes systematically | Prospect continuity weaker than staff side | **C** |
| **Dashboard AI chat** | Shipped (`/dashboard/copilot` → `POST /api/copilot/chat` → `handleAgentMessage`); parity-pending | Power users expect browser copilot | **C** (parity-pending) |
| **Intent edge cases** | 5 classifiers; thresholds 0.55–0.75 | “Push my visit” → wrong workflow | **B-** |
| **Transparency** | `agent_action_logs` exist; no dashboard UI | Admins cannot debug AI decisions easily | **C** |
| **Takeover semantics** | Dashboard takeover not sticky on WhatsApp inbound | Human thinks they “own” chat; AI resumes | **C** (product surprise) |

### vs `ai.md` principles

| Principle | Grade |
|-----------|-------|
| Stateful / remembers visits | **A** |
| Idempotent / no duplicate replies | **A-** |
| Proactive reminders | **A** |
| Contextual (“later” = reschedule) | **B+** |
| Transactional rollback | **B-** |
| Covers all intent variations | **B-** |
| Transparent (shows what it did) | **C** |
| Dashboard AI copilot | **C** (shipped, parity-pending) |

---

## 10. How it should work (target state)

### Memory

- **`leads.lead_memory` is the single source of truth** for “what AI knows.”
- After **every buyer turn**, extract facts (projects, budget, open questions, last intent) and `patchLeadMemory`.
- RAG (`client_memory_chunks`) becomes a **search index** derived from lead_memory + messages — not a competing truth.
- Staff and buyer prompts both read the same blob via `buildPromptMemoryBlock`.

### Workflows

- Visit mutations (`schedule_visit`, `reschedule_visit`, `cancel_visit`) run as **atomic sagas**:
  1. Snapshot pre-state
  2. Execute steps with idempotency key
  3. On failure after DB write → compensators run in reverse
  4. If compensation fails → `needs_reconciliation` + admin alert + honest user message
- No orphan visits without confirmation or alert.

### Intent

- Mutation workflows require confidence ≥ **0.75** to execute.
- Medium confidence → **clarification** (“Book new visit or change your existing one?”) with `pendingClarification` on conversation.
- Active visit context **biases** classifier toward `reschedule_visit` / `cancel_visit`.
- All borderline classifications logged to `agent_action_logs` with confidence + alternatives.

### Transparency

- Dashboard **AI Action Log** page: filterable table of recent autonomous actions (intent, confidence, inputs, result, status).
- Per-lead “what AI knows” panel showing `lead_memory` JSON (read-only for support).

### Dashboard copilot (Phase 2+)

- Optional in-browser staff copilot reusing `agent-router` logic via WebSocket or REST — same tools, same audit log.
- Not required for “fully functioning” WhatsApp experience; required for “full product parity.”

### Takeover semantics (product decision)

Choose one and implement consistently:

| Option | Behavior |
|--------|----------|
| **A. Sticky takeover** | If `agent_active`, buyer inbound does **not** auto-resume AI; only `release` or staff reply resumes |
| **B. WhatsApp-always-on** (current) | Any prospect message re-enables AI; dashboard takeover is monitor-only |

**Recommendation:** Option A for production CRM — document in Conversations UI.

---

## 11. How to fix each gap

### Gap 1 — Unified memory (Priority 1)

**Problem:** 8 stores; buyer path does not write back systematically.

**Fix:**

1. Add `extractAndPatchLeadMemory()` called after every successful buyer outbound (workflow, fast-path, `generateResponse`).
2. Extraction sources (cheap → expensive):
   - Deterministic: visit booked → `upcomingVisits`; property shown → `projectsDiscussed`
   - LLM micro-extract (optional): one JSON delta per turn, temp 0, capped 200 tokens
3. `syncLeadClientMemory` should **read from** `lead_memory` after patch, not compete with it.
4. Deprecate redundant prompt-only context once parity tests pass.

**Files:** `whatsapp.service.ts`, `ai.service.ts`, `lead-memory.service.ts`, `clientMemory.service.ts`

---

### Gap 2 — Full workflow saga rollback (Priority 2)

**Problem:** Step N succeeds, step N+1 fails → partial state.

**Fix:**

1. Before each mutation step in `runWorkflow`, snapshot: `lead.status`, `visit.status`, `visit.scheduledAt`.
2. On step failure after mutation:
   - Run compensators in **reverse order** (`compensateBookVisit`, revert status, cancel reminders).
   - Wrap compensators in try/catch; failure → `status: needs_reconciliation`.
3. User message: honest partial state (“Visit saved; confirmation sending — team notified”) never silent failure.
4. Calendar integration (if external): compensator must delete/revert calendar event same as DB.

**Files:** `workflow-engine.service.ts`, `workflow-compensator.service.ts`, `visit-actions.ts`, `automation.service.ts`

---

### Gap 3 — Dashboard AI action log viewer (Priority 3)

**Problem:** Logs exist; admins query via WhatsApp only.

**Fix:**

1. `GET /api/agent-action-logs?limit=50&action=&status=&from=&to=` (company-scoped, admin only).
2. Frontend page `AIActionLogsPage` or section under Audit Logs:
   - Columns: time, action, triggeredBy, status, resource, result snippet, duration
   - Filters: action name, status, date range
   - Row expand: full `inputs` JSON
3. Link from Conversations lead detail: “View AI actions for this lead.”

**Files:** new `agent-action-log.routes.ts`, `frontend/src/pages/ai-action-logs/`, `navigation.config.ts`

---

### Gap 4 — Mutation intent guardrails (Priority 4)

**Problem:** Borderline phrases misroute to wrong visit workflow.

**Fix:**

1. Confirm `MUTATION_CONFIDENCE_THRESHOLD = 0.75` enforced on buyer channel (not only staff).
2. Pre-classifier rules when `liveCtx.activeVisit` exists:
   - “push”, “move”, “change”, “later”, “can’t make” → bias `reschedule_visit`
   - “cancel”, “call off” → bias `cancel_visit`
3. Clarification reply template stored in `workflow-engine.service.ts`.
4. Log every clarification trigger: `{ workflowId, confidence, activeVisit: true }` → `agent_action_logs`.

**Files:** `workflow-engine.service.ts`, `workflow.constants.ts`, `customerVisitBooking.service.ts`

---

### Gap 5 — Dashboard AI chat (Priority 5 — later sprint)

**Status (updated):** Shipped. Browser copilot exists at `/dashboard/copilot` → `POST /api/copilot/chat` → `handleAgentMessage`. Remaining work is WhatsApp parity (quick-action chips, history load, kill-switch + rate-limit hardening), not initial build.

**Fix (minimal viable):**

1. `POST /api/copilot/chat` — same pipeline as `handleAgentMessage` without WhatsApp send.
2. Reuse `agent-router.service.ts` internals; return `{ text, replyKind, actionLogs }`.
3. Simple chat UI in dashboard sidebar (admin/sales roles).
4. Same `agent_action_logs` + confirmations.

**Effort:** 1–2 weeks after P1–P4 stable.

---

### Gap 6 — Takeover semantics (Priority 6 — product)

**Fix (if Option A chosen):**

1. `ensureProspectConversationAiActive`: skip re-enable if `agent_active` and `aiEnabled === false` **unless** `release` or 24h timeout.
2. Conversations UI banner: “AI paused — customer messages will not get auto-replies.”
3. Staff copilot `release_conversation` documented as paired action.

---

## 12. Sprint roadmap (1–2 sprints)

### Sprint 1 (Week 1–2) — Memory + transparency

| Priority | Initiative | Outcome |
|----------|------------|---------|
| **P1** | Unify buyer memory write-back | Every buyer turn patches `lead_memory`; fewer repeated questions |
| **P3** | Dashboard AI action log viewer | Admins debug without WhatsApp |

**Sprint 1 exit criteria:**

- [x] After buyer brochure request, `lead_memory.projectsDiscussed` updated (unit: `buyer-memory-extract.service.test.ts`)
- [x] After buyer visit book, `upcomingVisits` updated (unit: `buyer-memory-extract.service.test.ts`)
- [x] Admin sees last 50 actions in dashboard with filters (API: `agent-action-log.routes.test.ts`; UI: `/dashboard/ai-action-logs`)
- [x] No regression on inbound dedup / duplicate replies (workflow matrix 49/49)

---

### Sprint 2 (Week 3–4) — Reliability + intent

| Priority | Initiative | Outcome |
|----------|------------|---------|
| **P2** | Full saga rollback for visit mutations | No silent partial failures |
| **P4** | Mutation threshold + clarification + active-visit bias | Fewer wrong bookings |

**Sprint 2 exit criteria:**

- [ ] Simulated failure after `bookVisit` → compensated or `needs_reconciliation` + alert
- [x] “Push my appointment” with active visit → clarification or `reschedule_visit` (unit: `workflow-engine.service.test.ts`)
- [ ] Duplicate book same slot → idempotency cached reply, one visit row
- [ ] Clarification events appear in action log

---

## 13. Phased plan (full journey)

### Phase 0 — Done ✅

- Webhook 200-first, inbound DB dedup, processing locks, outbound dedup
- Workflow idempotency keys, `WorkflowRunRecord`, compensators (partial)
- `lead_memory` service, conversation context block, tiered confidence
- Buyer workflows 8/15 including visit mutations
- Copilot degradation (`llmEnabled` / `copilotEnabled` split)

### Phase 1 — Buyer memory + observability (Sprint 1)

- P1 unified memory write-back
- P3 dashboard action log viewer
- Misclassification logging to action log

### Phase 2 — Saga hardening + intent (Sprint 2)

- P2 atomic saga for visit mutations
- P4 active-visit bias + clarification polish
- E2E tests in scenario matrix

### Phase 3 — Product parity (Sprint 3–4)

- P5 dashboard copilot (optional MVP)
- P6 sticky takeover (product decision)
- Per-lead “AI memory” panel in lead detail

### Phase 4 — Polish (ongoing)

- Expand buyer workflows (`agent_availability`, post-visit feedback)
- Nightly LLM conversation summary → `lead_memory.conversationSummary`
- Align `ai.md` with shipped schema
- `docs/PRODUCTION_SCENARIO_PROOF.md` regression suite

---

## 14. Implementation checklists

### P1 — Unify buyer memory (single source of truth)

**Backend**

- [ ] Create `buyer-memory-extract.service.ts` with `extractLeadMemoryDelta({ message, reply, lead, conversation, liveCtx })`
- [ ] Deterministic extractors: visit events, property mentions, budget regex, location
- [ ] Optional LLM extract (feature flag `BUYER_MEMORY_LLM_EXTRACT=true`)
- [ ] Call `patchLeadMemory` from:
  - [ ] `whatsapp.service.ts` after workflow reply
  - [ ] `whatsapp.service.ts` after visit fast-path commit
  - [ ] `whatsapp.service.ts` after `generateResponse`
  - [ ] `ai.service.ts` after successful LLM response (extractedInfo merge)
- [ ] After `patchLeadMemory`, call `syncLeadClientMemory(leadId)` to refresh vectors
- [ ] Unit tests: book visit → memory has `upcomingVisits`; brochure → `projectsDiscussed`

**Acceptance**

- [ ] “What’s my budget?” — AI does not re-ask if already in `lead_memory`
- [ ] Support can `SELECT lead_memory FROM leads WHERE id = ?` and see full context

---

### P2 — Full workflow saga rollback

**Backend**

- [ ] `runWorkflow`: persist `stateSnapshot` before each mutation step
- [ ] On failure: invoke `runCompensationChain(completedMutationSteps, snapshot)`
- [ ] Compensators: `compensateBookVisit`, revert lead status, cancel automation jobs
- [ ] Set `WorkflowRunRecord.status` = `completed` | `failed` | `needs_reconciliation`
- [ ] `reconcileWorkflowRuns`: alert company admin via notification + optional WhatsApp
- [ ] Integration test: mock `sendVisitConfirmation` fail → visit cancelled or flagged

**Acceptance**

- [ ] No visit row without either confirmation sent or reconciliation flag within 5 min
- [ ] `agent_action_logs` contains `workflow_compensation` entries

---

### P3 — Dashboard AI action log viewer

**Backend**

- [ ] `GET /api/agent-action-logs` with pagination, filters (`action`, `status`, `resourceType`, `resourceId`)
- [ ] `authorize('audit_logs', 'read')` or new permission `ai_logs:read`
- [ ] `getRecentActionLogs` extended with date range + resource filter

**Frontend**

- [ ] New route `/ai-action-logs` (admin + company_admin)
- [ ] Table: createdAt, action, triggeredBy, actor, status, resource, result (truncated)
- [ ] Expand row → full inputs JSON
- [ ] Filter bar: action search, status dropdown, last 24h / 7d / 30d
- [ ] i18n keys in `en.json`

**Acceptance**

- [ ] Admin sees `customerVisitBooked`, `workflow_compensation`, `classifyWorkflow` entries
- [ ] Filter by `resourceId` = leadId shows all AI actions for that lead

---

### P4 — Mutation intent guardrails

**Backend**

- [ ] Verify buyer path uses `evaluateMutationConfidence` (not bypassing clarification)
- [ ] Add `activeVisitBias` pre-rules in `classifyAndRunBuyerWorkflow` / fast-path
- [ ] Clarification templates: book vs reschedule vs cancel
- [ ] `resolvePendingClarification` covered by unit tests for buyer channel
- [ ] Log `{ action: 'workflow_clarification', inputs: { workflowId, confidence } }`

**Acceptance**

- [ ] Active visit + “push to Sunday” → reschedule or clarification, never duplicate book
- [ ] Confidence 0.70 + active visit → clarification message, no DB write

---

### P5 — Dashboard copilot (later)

- [ ] `POST /api/copilot/chat` endpoint
- [ ] Reuse `handleAgentMessage` core; session via `agent_sessions`
- [ ] Chat UI component with history
- [ ] Role gating matching WhatsApp copilot roles
- [ ] Rate limit per user

---

### P6 — Sticky takeover (product)

- [ ] Product sign-off on Option A vs B
- [ ] If A: change `ensureProspectConversationAiActive`
- [ ] Conversations UI copy + status badge
- [ ] Test: takeover → customer message → no AI reply until release

---

## 15. Acceptance test matrix

| # | Scenario | Actor | Pass criteria |
|---|----------|-------|---------------|
| 1 | Book visit Saturday 4pm | Buyer | One visit; memory `upcomingVisits` updated; one confirmation |
| 2 | Same book retried (new message_id) | Buyer | Idempotency reply; one visit row |
| 3 | “Push to Sunday” with active visit | Buyer | Reschedule or clarification; no duplicate visit |
| 4 | “Lake Vista price again” after brochure | Buyer | Reply references prior price from memory |
| 5 | Workflow fails at send confirmation | System | Compensated or `needs_reconciliation` visible in dashboard log |
| 6 | Admin opens AI action logs | Admin | Sees last actions with inputs/result |
| 7 | Staff “visits today” with LLM off | Staff | Deterministic reply still works |
| 8 | Dashboard takeover then customer texts | Buyer | **Depends on P6 decision** — document expected behavior |
| 9 | Staff reschedule via copilot | Staff | One workflow run; action log entry; lead memory updated |
| 10 | Wrong-report message | Buyer | Deterministic ack; no LLM escalation |

---

## 16. File touch map

| Initiative | Primary files |
|------------|---------------|
| Buyer memory write-back | `whatsapp.service.ts`, `ai.service.ts`, `lead-memory.service.ts`, new `buyer-memory-extract.service.ts` |
| Saga rollback | `workflow-engine.service.ts`, `workflow-compensator.service.ts`, `visit-actions.ts` |
| Action log API | new `routes/agent-action-log.routes.ts`, `agent-action-log.service.ts` |
| Action log UI | `frontend/src/pages/ai-action-logs/`, `navigation.config.ts`, `App.tsx` |
| Intent guardrails | `workflow-engine.service.ts`, `workflow.constants.ts`, `customerVisitBooking.service.ts` |
| Dashboard copilot | new `routes/copilot.routes.ts`, `agent-router.service.ts`, frontend chat component |
| Takeover semantics | `whatsapp.service.ts`, `conversation.routes.ts`, `ConversationsPage.tsx` |

---

## Analogies (quick reference)

| Concept | Analogy |
|---------|---------|
| Whole system | Hospital: triage → wards (buyer vs staff) → pharmacy (workflows) → therapist (LLM) |
| Buyer AI | Sales trainee with a script (policy) and thesaurus (LLM) |
| Staff copilot | Siri for CRM — WhatsApp only today |
| Dashboard | Air traffic control — humans watch and take the stick |
| Memory | Filing cabinet + search engine + whiteboard — should become one filing cabinet |
| Intent | Five bouncers; cheap checks before LLM |
| Takeover | Pilot says “my controls” — today autopilot re-engages on next customer message |
| Action logs | Black box flight recorder — exists, needs a cockpit display |

---

## References

- Ideal behavior: [`ai.md`](./ai.md)
- Technical gap tracker: [`ai-implementation-plan.md`](./ai-implementation-plan.md)
- Capabilities: `backend/src/constants/ai-capabilities.constants.ts`
- Workflow catalog: `backend/src/services/workflow/workflow-catalog.util.ts`

---

*Update this document when each sprint ships. Link PRs to checklist sections (e.g. “Implements P1 buyer memory write-back”).*
