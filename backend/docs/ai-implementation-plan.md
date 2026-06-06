# AI Agent WhatsApp — Reality Check, Gaps & Implementation Plan

> **Purpose:** Document how the production system works today, where it falls short of `ai.md`, and a phased plan to close the gaps.  
> **Audience:** Engineering / product.  
> **Last updated:** 2026-06-06 (Gaps 1–7 shipped — workflow saga, idempotency, LeadMemory, tiered confidence, copilot degradation).

---

## 1. How it works today (summary)

### Single entry point

```
Meta / GreenAPI webhook
  → res.sendStatus(200) immediately
  → whatsappService.handleIncomingMessage()
```

Key files:

| Area | File |
|------|------|
| Webhook ingress | `backend/src/routes/webhook.routes.ts`, `greenapi-webhook.routes.ts` |
| Identity routing | `backend/src/services/inboundWhatsAppRouting.service.ts` |
| Buyer pipeline | `backend/src/services/whatsapp.service.ts` |
| Staff copilot | `backend/src/services/agent/agent-router.service.ts` |
| Workflow engine | `backend/src/services/workflow/workflow-engine.service.ts` |
| Action handlers (45) | `backend/src/services/workflow/actions/index.ts` |
| Workflow catalog (15) | `backend/src/services/workflow/workflow-catalog.util.ts` |
| Inbound dedup | `backend/src/services/inboundMessageGuard.service.ts` |
| Ideal spec | `backend/docs/ai.md` |

### Identity split

| Sender | Route |
|--------|--------|
| Phone **not** on company `users` | **Buyer** — full prospect AI |
| Staff (`super_admin`, `company_admin`, `sales_agent`, `operations`) | **Investo Copilot** |
| Other staff roles (e.g. viewer) | Static “use dashboard” notice |

### Staff copilot order

1. Greeting / help (deterministic)
2. Pending confirmation (YES/NO)
3. `tryDeterministicAgentCrmReply`
4. `classifyAndRunWorkflow` (15 workflows)
5. `classifyAndExecuteAgentIntent`
6. `invokeAgent` + client memory RAG
7. Fallback help menu

### Buyer order

1. Interactive button handling
2. `tryCommitCustomerVisitBooking` (visit fast-path)
3. `classifyAndRunBuyerWorkflow` (5 workflows only)
4. Deterministic visit-status query
5. `aiService.generateResponse` (stage machine + RAG)
6. Contextual quick replies / filters / media

### Buyer vs staff workflows

| Channel | Workflow IDs | Count |
|---------|--------------|-------|
| Staff | All `WORKFLOW_IDS` | 15 |
| Buyer | `BUYER_WORKFLOW_IDS` | 5 (`brochure_request`, `price_inquiry`, `availability_check`, `amenities_question`, `escalate_to_human`) |

Visit book / reschedule / cancel for **buyers** intentionally bypass the workflow catalog and use fast-path + main AI to avoid double-write races.

---

## 2. Reality check scorecard

| Ideal principle (`ai.md`) | Production today | Grade |
|---------------------------|------------------|-------|
| Stateful / remembers visits | DB visits + `liveLeadContext` + conversation stage | **A** |
| Idempotent / no duplicate replies | Inbound DB + Redis + outbound claims + workflow idempotency keys | **A** |
| Transactional workflow rollback | Saga step tracking + compensators + reconciliation cron | **B+** |
| Proactive reminders | `automation.service` (24h/1h, follow-ups) | **A** |
| Buyer workflows cover all actions | 8 buyer workflows incl. visit mutations via `runWorkflow` | **B+** |
| Centralized memory JSON | `leads.lead_memory` + `leadMemory.service.ts` | **B** |
| LLM misclassification guardrails | Tiered confidence + clarification loop | **B+** |
| Zero-UI reliability (no kill-switch) | `llmEnabled` / `copilotEnabled` split; deterministic degradation | **B** |
| Context injection (last facts) | `conversation-summary.service.ts` + LeadMemory in prompts | **B+** |

---

## 3. Known gaps — problem, fix, implementation

### Gap 1 — Partial transaction rollback (Critical)

**Problem**

`runWorkflow()` executes steps sequentially. If step N succeeds and step N+1 fails, earlier side effects remain.

Example (`schedule_visit`):

```
resolveLead → bookVisit → updateLeadStatusVisitScheduled → sendVisitConfirmation → scheduleVisitReminders
```

Failure after `bookVisit` can leave: visit in DB, lead status updated, but no customer confirmation WhatsApp.

**Root cause:** `backend/src/services/workflow/workflow-engine.service.ts` — no saga/compensation; `WORKFLOW_ACTION_HANDLERS` mutate DB and send messages independently.

**Fix options**

| Approach | Pros | Cons |
|----------|------|------|
| **A. Compensating saga** | True rollback semantics | More code per workflow |
| **B. Outbox + async steps** | Reliable retries | Delayed user feedback |
| **C. Idempotent steps + reconciliation job** | Simpler; matches WhatsApp retries | “Eventually consistent” |

**Recommended: C + limited A for visit mutations**

1. Tag each workflow run with `workflowRunId` in `agent_action_logs`.
2. Mark each step `pending | completed | failed | compensated`.
3. On failure after a mutation step, run compensators:
   - `bookVisit` failed after create → `cancelVisit` compensator
   - `updateLeadStatus` → revert to previous status from snapshot
4. Nightly / hourly `reconcileWorkflowRuns()` alerts on `completed_with_errors`.

**Implementation tasks**

- [x] Add `WorkflowRunRecord` table: `id`, `workflowId`, `companyId`, `channel`, `idempotencyKey`, `status`, `stepsJson`, `createdAt`
- [x] Wrap `runWorkflow` loop: snapshot state before mutation steps
- [x] Implement compensators for `bookVisit`, `cancelVisit`, `updateLeadStatus`
- [x] On partial failure: staff reply = “Visit saved but confirmation pending — team notified” + internal alert
- [x] Unit tests: workflow-engine saga + idempotency mocks

**Effort:** ~3–5 days | **Priority:** P0

---

### Gap 2 — Buyer workflow set is too narrow

**Problem**

Buyers cannot use `schedule_visit`, `reschedule_visit`, `cancel_visit` via the workflow engine. Logic is split across:

- `tryCommitCustomerVisitBooking` (`customerVisitBooking.service.ts`)
- `applyVisitMutationFromChat` (`visitMutationFromChat.service.ts`)
- `aiService.generateResponse`
- Interactive buttons in `whatsapp.service.ts`

This was intentional (comment in `whatsapp.service.ts`: avoid fast-path + workflow double-write). It increases maintenance and blocks buyer-specific steps (e.g. “remind me later”).

**Fix: Unified buyer workflows with channel-aware handlers**

1. Extend `BUYER_WORKFLOW_IDS`:

   ```ts
   'schedule_visit' | 'reschedule_visit' | 'cancel_visit'
   ```

2. Add `channel: 'buyer' | 'staff'` guards inside actions:
   - `notifyAgent` — skip or use lighter template for buyer-initiated book
   - `sendWelcome` — already skips when `channel === 'staff'`; mirror for buyer-only confirmations
   - `sendVisitConfirmation` — always to **customer** phone, not staff

3. **Single entry rule:** If `visitCommit.committed === true`, **never** call buyer workflow for that turn (keep existing guard).

4. Deprecate duplicate logic in fast-path gradually:
   - Phase 1: fast-path for date parsing only → returns params → `runWorkflow('reschedule_visit', params)`
   - Phase 2: remove inline DB writes from fast-path

**Implementation tasks**

- [x] Add buyer workflow definitions in `workflow-registry.ts` (channel guards on staff-only steps)
- [x] Audit `visit-actions.ts` / `lead-actions.ts` for `ctx.run.channel`
- [x] Refactor `tryCommitCustomerVisitBooking` to return `workflowSuggestion` when parse succeeds
- [x] Unit test: buyer “reschedule to Sunday 11am” → one DB write, one outbound message

**Effort:** ~5–7 days | **Priority:** P1

---

### Gap 3 — No centralized memory object

**Problem**

Lead context is scattered:

| Store | What it holds |
|-------|----------------|
| `leads` | budget, status, phone, preferences |
| `conversations` | stage, commitments, selected property |
| `clientMemory.service` | vector / sync metadata |
| `liveLeadContext.service` | active visit snapshot |

Hard to answer: “What does the AI know about this lead?” without joining 4 sources.

**Fix: `LeadMemory` JSON blob**

Add to `leads` or new `lead_memory` table:

```json
{
  "version": 1,
  "updatedAt": "2026-06-06T12:00:00Z",
  "projectsDiscussed": [{ "propertyId", "name", "factsShown": ["price", "amenities"] }],
  "budget": { "min", "max", "currency" },
  "locationPreference": "Whitefield",
  "upcomingVisits": [{ "visitId", "propertyName", "scheduledAt", "status" }],
  "lastIntent": "reschedule_visit",
  "conversationSummary": "User booked Lake Vista Saturday 4pm, now wants Sunday.",
  "openQuestions": []
}
```

**Write path:** After every inbound/outbound turn (buyer + staff), `mergeLeadMemory(delta)`.

**Read path:** `buildPromptMemoryBlock(leadId)` injected into buyer AI + staff `invokeAgent`.

**Implementation tasks**

- [x] Prisma: `leadMemory Json?` on `Lead`
- [x] `leadMemory.service.ts`: `get`, `patch`, `buildPromptBlock`
- [x] Hook: `syncLeadMemory` + `recordAgentCopilotExchange` → `patchLeadMemory`
- [x] Migrate: backfill from existing visit + conversation on first `getLeadMemory`
- [ ] Deprecate redundant fields only after parity tests

**Effort:** ~4–6 days | **Priority:** P1

---

### Gap 4 — LLM misclassification (threshold 0.62)

**Problem**

`WORKFLOW_CONFIDENCE_THRESHOLD = 0.62` (`workflow.constants.ts`) is one global bar. Sensitive workflows (`schedule_visit`, `reschedule_visit`, `cancel_visit`) need stricter handling.

Edge case: “push my appointment” → misclassified as `schedule_visit` instead of `reschedule_visit`.

**Fix: Tiered confidence + clarification loop**

| Confidence | Behavior |
|------------|----------|
| ≥ 0.80 | Execute workflow |
| 0.65 – 0.79 (mutation workflows) | Clarification: “Book new visit or change existing?” |
| < 0.65 | Fall through to deterministic CRM / fast-path / agent |

**Implementation tasks**

- [x] Add `MUTATION_WORKFLOW_IDS` and `MUTATION_CONFIDENCE_THRESHOLD = 0.75`
- [x] Add `CLARIFICATION_BAND = [0.65, 0.75]` → return structured clarification reply (no DB write)
- [x] Store `pendingClarification` on `Conversation.commitments`
- [x] Next message resolves clarification via `resolvePendingClarification`
- [ ] Log misclassifications to `agent_action_logs` for review

**Effort:** ~2–3 days | **Priority:** P1

---

### Gap 5 — No workflow-level idempotency

**Problem**

Inbound dedup (`inbound_whatsapp_dedup` + Redis) stops the **same webhook** twice. It does **not** stop:

- Same intent from two devices (different `message_id`)
- User retries “book visit Saturday 4pm” after timeout
- Staff and buyer paths both firing on dual-provider delivery (mitigated by fingerprint, not intent key)

**Fix: Intent idempotency keys**

Derive key from normalized intent + params:

```
schedule_visit:{companyId}:{leadId}:{scheduledAtISO}
reschedule_visit:{companyId}:{visitId}:{newScheduledAtISO}
```

Store in Redis (24h TTL) or `workflow_idempotency` table:

```ts
{ key, workflowId, resultReply, status: 'completed', createdAt }
```

On duplicate key: return cached `resultReply` without re-executing handlers.

**Implementation tasks**

- [x] `buildWorkflowIdempotencyKey(workflowId, params)` in `workflow-engine.service.ts`
- [x] `claimWorkflowExecution(key)` before `runWorkflow` loop
- [x] Persist result on success; on failure clear claim (allow retry)
- [x] Staff + buyer channels share same key namespace per `leadId`/`visitId`
- [ ] Tests: two different `message_id`s, same intent → one visit row (E2E)

**Effort:** ~2–3 days | **Priority:** P0 (pairs with Gap 1)

---

### Gap 6 — Staff copilot kill-switch (`agentAi.enabled`)

**Problem**

When `config.agentAi.enabled === false`:

- Staff get “Agent copilot is temporarily unavailable. Please use the Investo dashboard.”
- Workflows and intent orchestrator also return `null` immediately

This breaks zero-UI WhatsApp operations for field staff.

**Fix: Graceful degradation ladder**

| `agentAi.enabled` | Staff behavior |
|-----------------|---------------|
| `true` | Full stack (current) |
| `false` | **Tier 1:** Deterministic CRM only (`tryDeterministicAgentCrmReply`) |
| | **Tier 2:** Workflow regex fallbacks for visit list / confirm |
| | **Tier 3:** Static command cheat sheet (never blank “use dashboard”) |

Remove hard block in `routeCompanyScopedInbound` when only LLM is disabled.

**Implementation tasks**

- [x] Split config: `agentAi.llmEnabled` vs `agentAi.copilotEnabled`
- [x] `routeIfInternalUserForCompany`: if LLM off, skip `invokeAgent` / intent classifiers; keep deterministic CRM
- [x] Update `classifyAndRunBuyerWorkflow` to allow regex fallback when LLM disabled
- [x] Ops: `AGENT_AI_LLM_ENABLED` / `AGENT_AI_COPILOT_ENABLED` env vars (replaces “no LLM”, not “no copilot”

**Effort:** ~1–2 days | **Priority:** P2

---

### Gap 7 — Conversation stage vs rolling context summary

**Problem**

`conversation.stage` (`rapport`, `qualify`, `shortlist`, …) is coarse. After 10 messages, the model may not know the user already received price, amenities, and brochure for Lake Vista.

**Fix: Cheap rolling summary (last 3–5 facts)**

Before every `aiService.generateResponse` and `invokeAgent` call, inject:

```
Recent context:
- Discussed: Lake Vista (price ₹1.2Cr, brochure sent)
- Budget: 1–1.5 Cr, 3 BHK
- Visit: Saturday 4pm scheduled, status confirmed
- Last user ask: reschedule
```

**Sources (in order):**

1. `LeadMemory` blob (Gap 3) once available
2. Until then: last 5 customer messages + last 3 AI messages + `liveLeadContext`
3. Optional: nightly LLM summary → store in `conversation.summary` (100 tokens max)

**Implementation tasks**

- [ ] `buildConversationContextBlock(conversationId, leadId)` in `clientMemory.service.ts` or new `conversationSummary.service.ts`
- [ ] Inject into `ai.service.ts` prompt builder and `buildSystemPrompt` client block
- [x] Cap tokens (~400); strip boilerplate
- [ ] Test: “Tell me about Lake Vista again” → reply references prior price without re-asking budget

**Effort:** ~2 days | **Priority:** P1

---

## 4. Phased implementation plan

### Phase 0 — Done (2026-06-06)

- [x] Webhook immediate `200`
- [x] DB inbound idempotency (`inbound_whatsapp_dedup`)
- [x] Per-user processing locks (staff + buyer)
- [x] Outbound reply dedup (staff + buyer)
- [x] Workflow duplicate-step guard in single run
- [x] Agent action dedup per `message_id`

### Phase 1 — Reliability (2 weeks, P0)

**Goal:** No double bookings; no silent partial failures.

| # | Work item | Gap | Owner hint |
|---|-----------|-----|------------|
| 1.1 | Workflow idempotency keys + result cache | 5 | `workflow-engine.service.ts` |
| 1.2 | `WorkflowRunRecord` + step status tracking | 1 | New table + engine |
| 1.3 | Compensators for visit book/cancel/status | 1 | `visit-actions.ts` |
| 1.4 | Reconciliation cron + admin alert | 1 | `automation.service.ts` |
| 1.5 | Tiered confidence for mutation workflows | 4 | `workflow.constants.ts` |

**Exit criteria**

- Duplicate “book Saturday 4pm” from two phones → one visit
- Simulated failure after `bookVisit` → flagged `needs_reconciliation` or compensated
- “push my appointment” with active visit → clarification or `reschedule_visit`

### Phase 2 — Unification (2–3 weeks, P1)

**Goal:** One mental model for buyer + staff visit actions.

| # | Work item | Gap |
|---|-----------|-----|
| 2.1 | Buyer `schedule_visit` / `reschedule_visit` / `cancel_visit` in catalog | 2 |
| 2.2 | Fast-path returns params; workflow executes mutations | 2 |
| 2.3 | `LeadMemory` JSON + prompt injection | 3, 7 |
| 2.4 | Rolling conversation summary block | 7 |

**Exit criteria**

- Buyer reschedule path uses `runWorkflow` with `channel: 'buyer'`
- Prompt includes memory blob; support can inspect one JSON per lead

### Phase 3 — Zero-UI hardening (1 week, P2)

| # | Work item | Gap |
|---|-----------|-----|
| 3.1 | Split `agentAi.llmEnabled` / `copilotEnabled` | 6 |
| 3.2 | Deterministic-only degradation mode | 6 |
| 3.3 | Observability dashboard: workflow runs, idempotency hits, clarifications | all |

### Phase 4 — Polish (ongoing)

- Align `ai.md` with implemented memory schema
- Expand buyer workflows (`agent_availability`, post-visit feedback)
- E2E scenario proofs in `docs/PRODUCTION_SCENARIO_PROOF.md`

---

## 5. Testing matrix (acceptance)

| Scenario | Actor | Expected after Phase 1+2 |
|----------|-------|--------------------------|
| Book visit Saturday 4pm | Buyer | One visit row; one confirmation; idempotent retry |
| Same book from second phone | Buyer | Cached idempotency reply; no second visit |
| Reschedule with active visit | Buyer | `reschedule_visit` workflow; no double-write |
| “push my appointment” | Buyer | Clarification or correct reschedule |
| schedule_visit fails at WhatsApp send | Staff | Reconciliation flag; no orphan without alert |
| `agentAi.llmEnabled=false` | Staff | “visits today” still works deterministically |
| “Lake Vista price again” after brochure | Buyer | Summary mentions prior brochure/price |

---

## 6. File touch map (quick reference)

| Change | Primary files |
|--------|----------------|
| Workflow idempotency | `workflow-engine.service.ts`, `inboundMessageGuard.service.ts` |
| Saga / run record | `workflow-engine.service.ts`, `prisma/schema.prisma` |
| Buyer workflow unification | `workflow.constants.ts`, `whatsapp.service.ts`, `customerVisitBooking.service.ts` |
| Lead memory | New `leadMemory.service.ts`, `ai.service.ts`, `agent-router.service.ts` |
| Confidence tiers | `workflow.constants.ts`, `workflow-engine.service.ts`, `agent-intent-orchestrator.service.ts` |
| Copilot degradation | `config/index.ts`, `inboundWhatsAppRouting.service.ts`, `agent-router.service.ts` |
| Context summary | `ai.service.ts`, `clientMemory.service.ts` |

---

## 7. References

- Ideal behavior spec: [`ai.md`](./ai.md)
- Capability map: `backend/src/constants/ai-capabilities.constants.ts`
- Workflow catalog: `backend/src/services/workflow/workflow-catalog.util.ts`
- Inbound dedup migration: `backend/prisma/migrations/20260605230000_add_inbound_whatsapp_dedup/`

---

*This document should be updated when each phase ships. Link PRs to section numbers (e.g. “Implements 1.1 workflow idempotency”).*
