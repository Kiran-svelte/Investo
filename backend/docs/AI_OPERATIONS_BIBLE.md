# Investo AI Operations Bible

**Single reference when anything is wrong with buyer AI, staff copilot, workflows, memory, or WhatsApp.**

Read this first. Diagnose using §8. Fix using §9. Re-verify using §10. Do not ship until §7 checklist passes.

| Meta | Value |
|------|-------|
| **Prod backend** | `https://investo-backend-production.up.railway.app` |
| **Prod frontend** | `https://biginvesto.online` |
| **Palm tenant (handset)** | `a9c308d8-1083-4981-bd46-3667e0474e8e` |
| **Last major hygiene deploy** | v0.1.7–v0.1.9 (2026-06-06) |
| **Companion docs** | `investo.md` §2–§5, `docs/A_PLUS_PROOF.md`, `backend/docs/ai.md` |

---

## 0. How to use this document

```
Issue reported
    → §8 Symptom index (find your symptom)
    → §8.2 Diagnosis commands (run audit/script/SQL)
    → §9 Fix playbook (exact file + expected behavior)
    → §10 Re-verify (strict scenario runner + audit)
    → §7 Correctness checklist (all layers green)
```

**Golden output rule (non-negotiable):**

> Return **only** valid answers, buttons, actions, and workflows.  
> **No** unrelated catalog dumps, internal errors, staff-only text, duplicate replies, or invented connection failures.  
> **No miss** of required confirmations, escalations, visit rows, or `agent_action_logs` entries.

---

## 1. The six pillars (how AI *should* behave)

| Pillar | Meaning | Proof in prod |
|--------|---------|---------------|
| **Stateful** | `leads.lead_memory` is source of truth; never ask budget/location twice | Scenario #10, `buildBuyerMemoryRecallReply` |
| **Proactive** | After qualify → suggest brochure / visit / matching projects | `buyerQualification.service.ts` ack |
| **Contextual** | Active visit + “push to Sunday” → `reschedule_visit`, not new `schedule_visit` | `detectActiveVisitMutationBias` |
| **Idempotent** | Same book message twice → ≤1 new visit row | `claimWorkflowExecution` + visit idempotency key |
| **Graceful** | User sees human-safe text, never `Workflow "x" failed at step` | `buildBuyerWorkflowFailureReply` |
| **Transparent** | `agent_action_logs` records `workflow_*` per buyer turn | `workflow-engine.service.ts` post-run log |

---

## 2. Actors and surfaces

| Actor | Channel | Entry | Brain |
|-------|---------|-------|-------|
| **Buyer (client)** | WhatsApp Meta webhook | `POST /api/webhook` → `whatsapp.service.ts` | Fast-paths → workflows → `ai.service.ts` |
| **Staff (agent/admin)** | WhatsApp same webhook | `inboundWhatsAppRouting.service.ts` | `agent-router.service.ts` → tools / LangGraph |
| **Viewer** | WhatsApp | Same routing, read-only tools | Queries only, no mutations |
| **Investo user (dashboard)** | Browser | `POST /api/copilot/chat` | Same agent stack as staff copilot |
| **Cron / automation** | Internal | `automation.service.ts`, `cron-scheduler.service.ts` | Reminders, follow-ups (not conversational) |

---

## 3. Buyer WhatsApp routing order (exact short-circuit chain)

**File:** `backend/src/services/whatsapp.service.ts` (AI block, `conversation.status === 'ai_active'`)

Order matters. **First match wins.** Never run two mutation paths on the same inbound message.

```
1. Dedup          inbound_whatsapp_dedup + messages.whatsapp_message_id UNIQUE
2. Lead resolve   auto-create lead if stranger
3. Human takeover if conversation.humanTakeover / agent_active → stop AI
4. tryCommitCustomerVisitBooking()     ← visit fast-path (book/reschedule/cancel)
5. isBuyerRapportMessage()             ← deterministic welcome (no LLM)     [v0.1.9+]
6. isBuyerQualificationStatement()     ← patch memory + ack (no LLM)       [v0.1.9+]
7. isBuyerMemoryRecallQuery()          ← deterministic memory recall       [v0.1.7+]
8. isBuyerVisitStatusQuery()           ← deterministic visit lookup        [buyerVisitQuery.service.ts]
9. visitCommit.workflowSuggestion      → runWorkflow (one workflow only)
10. classifyAndRunBuyerWorkflow()      → LLM classify + runWorkflow
    ├─ detectBuyerNegotiationEscalationBias (discount → escalate)
    ├─ detectActiveVisitMutationBias (push/reschedule/cancel)
    ├─ pending clarification resume
    └─ classifyWorkflowMessage (temp=0)
11. ai.service.generateResponse()      ← language brain + policy brain
12. catch → buildAiFallbackMessage()   ← LAST RESORT (should be rare)
```

**After any outbound AI text:** `extractAndPatchLeadMemory` → `syncLeadClientMemory` (RAG).

---

## 4. Staff / dashboard copilot routing order

**File:** `backend/src/services/agent/agent-router.service.ts`

```
1. isCopilotGreeting → deterministic welcome
2. Pending confirmation (yes/no on destructive action)
3. Deterministic CRM queries (visits today, new leads today)
4. classifyAndRunWorkflow (staff channel, temp=0)
5. classifyAgentIntent (temp=0.05) → tool execution
6. invokeAgent (LangGraph) with last 5 turns in system prompt
7. Deterministic fallback string
```

**Viewer:** subset of tools (read-only). **Never** schedule visits or update lead status.

---

## 5. Fifteen CRM workflows (canonical)

**Registry:** `backend/src/services/workflow/workflow-registry.ts`  
**Engine:** `backend/src/services/workflow/workflow-engine.service.ts`  
**Actions:** `backend/src/services/workflow/actions/`

| # | Workflow ID | Channel | Mutates DB | Key steps |
|---|-------------|---------|------------|-----------|
| 1 | `new_lead` | staff | yes | createLead → assign → welcome |
| 2 | `update_status` | staff | yes | resolveLead → updateLeadStatus |
| 3 | `add_note` | staff | yes | resolveLead → addLeadNote |
| 4 | `assign_agent` | staff | yes | resolveLead → resolveAgent → reassign |
| 5 | `schedule_visit` | **buyer+staff** | yes | resolveLead → **bookVisit** → reminders |
| 6 | `reschedule_visit` | **buyer+staff** | yes | resolveVisit → bookVisit (in-place buyer) |
| 7 | `cancel_visit` | **buyer+staff** | yes | resolveVisit → cancelVisit |
| 8 | `complete_visit` | staff | yes | resolveVisit → completeVisit |
| 9 | `mark_visit_outcome` | staff | yes | resolveVisit → recordVisitOutcome |
| 10 | `price_inquiry` | **buyer** | no | fetchPropertyPrice → respondPrice |
| 11 | `availability_check` | **buyer** | no | checkInventory → respondAvailability |
| 12 | `brochure_request` | **buyer** | no* | sendBrochure → logBrochureRequest |
| 13 | `amenities_question` | **buyer** | no | answerAmenities |
| 14 | `agent_availability` | staff | no | checkCalendar → suggestAlternatives |
| 15 | `escalate_to_human` | **buyer+staff** | yes | takeover → alert → notifyAllAgents |

\*Brochure may send WhatsApp media; logged as `workflow_brochure_request`.

### Buyer workflow confidence (A+ spec)

**File:** `backend/src/constants/workflow.constants.ts`

| Band | Threshold | Behavior |
|------|-----------|----------|
| Query workflows | ≥ **0.65** | Execute price/brochure/availability |
| Mutation clarify | **0.70 – 0.80** | Ask clarification; log `workflow_clarification` |
| Mutation execute | ≥ **0.80** | Book / reschedule / cancel |
| Classifier temperature | **0.0** | `WORKFLOW_LLM_TEMPERATURE` |

### Idempotency keys

| Workflow | Key shape |
|----------|-----------|
| `schedule_visit` | `schedule_visit:{companyId}:{leadId}:{scheduledAt ISO}` |
| `reschedule_visit` | `reschedule_visit:{companyId}:{visitId}:{newScheduledAt ISO}` |
| `cancel_visit` | `cancel_visit:{companyId}:{visitId}` |

---

## 6. Intent → workflow → tool chain

### Buyer (no LangGraph tools — workflow actions call tools internally)

```
Inbound text
  → bias detectors (negotiation, active-visit mutation)
  → LLM JSON classifier (workflowId + parameters)
  → enrichWorkflowParams (UUID sanitize, lead_memory property, parseVisitDateTime)
  → runWorkflow(step loop)
  → each action may call runNamedTool('scheduleVisit' | 'getPropertyDetails' | ...)
  → formatBuyerWorkflowReply (strip IDs, staff lines)
  → single WhatsApp outbound
```

**Critical enrichments** (`action-helpers.ts`):

- Invalid `propertyId` from classifier (e.g. `"Sunset Heights"`) → coerced to `propertyName` lookup
- `projectsDiscussed` from `lead_memory` → auto-fill `propertyId`
- `parseRescheduleTargetFromMessage` / `parseVisitDateTimeFromMessage` for dates

### Staff intent map

**File:** `workflow-registry.ts` → `INTENT_TO_WORKFLOW`

Examples: `schedule_visit` intent → `schedule_visit` workflow; `send_brochure` → `brochure_request`.

### Staff tools by role

**File:** `backend/src/services/agent/tools/index.ts`

| Role | Tools |
|------|-------|
| viewer | property, analytics, calendar, emi (read) |
| sales_agent | + workflow, visit, lead, conversation, calendar, analytics |
| company_admin | + user, admin, admin-log |

---

## 7. Correctness checklist (run after every fix)

| # | Layer | Check | How to verify | Target |
|---|-------|-------|---------------|--------|
| 1 | Agent | Correct workflow for 12 handset scenarios | `buyer-scenario-runner.mjs --all` | 12/12 strict |
| 2 | Agent | Parameters: date, time, project UUID | Audit `workflow_run_records.steps_json` | No `Invalid uuid` |
| 3 | Tool | Tool maps to correct workflow action | Unit: `workflow-scenario-matrix` 49/49 | PASS |
| 4 | Tool | Required params validated before mutate | Logs show failed step with safe reply | No DB ghost rows |
| 5 | Workflow | All steps present per registry | Compare `steps_json` to registry | completed |
| 6 | Workflow | Step order (e.g. resolveLead before bookVisit) | `steps_json` order | match registry |
| 7 | Action | Errors → customer-safe text | Audit: no `INTERNAL_WORKFLOW_LEAK` | §8.1 |
| 8 | Action | Consistent WhatsApp formatting | No `Lead marked`, no raw UUID lines | `stripBuyerInternalWorkflowLines` |
| 9 | Chain | Data passes leadId → visitId → propertyId | `stateSnapshot` in workflow_run_records | populated |
| 10 | Chain | Failures logged with context | `agent_action_logs` `workflow_*` status failed | present |

---

## 8. Symptom index & diagnosis

### 8.1 Automated audit (run first)

```powershell
cd backend
# Strict functional test (12 buyer scenarios)
$env:BUYER_PHONE='919000089200'
npx tsx scripts/buyer-scenario-runner.mjs --all

# Deep audit: message leaks, workflow failures, action logs
npx tsx scripts/buyer-scenario-audit.mjs --phone 919000089200
```

**Audit error codes:**

| Code | Meaning |
|------|---------|
| `INTERNAL_WORKFLOW_LEAK` | Buyer saw `Workflow "…" failed` or `Invalid uuid` |
| `GENERIC_CONNECTION_FALLBACK` | Saw “brief technical/connection issue” |
| `MULTIPLE_AI_REPLIES` | >1 AI message per inbound turn |
| `CATALOG_INSTEAD_OF_VISIT` | Catalog dump when user asked to book |
| `FABRICATED_DISCOUNT` | AI offered % off (must escalate) |

### 8.2 SQL proof queries

```sql
-- Memory
SELECT lead_memory FROM leads WHERE phone = '+919000089200';

-- Action logs (expect workflow_* per turn)
SELECT action, status, inputs, result, created_at
FROM agent_action_logs
WHERE resource_id = '<lead_id>'
ORDER BY created_at DESC LIMIT 30;

-- Workflow runs
SELECT workflow_id, status, failed_step, steps_json, created_at
FROM workflow_run_records
WHERE company_id = 'a9c308d8-1083-4981-bd46-3667e0474e8e'
  AND channel = 'buyer'
ORDER BY created_at DESC LIMIT 20;

-- Visit idempotency
SELECT id, status, scheduled_at FROM visits WHERE lead_id = '<lead_id>';
```

### 8.3 Unit / integration matrix

```powershell
cd backend
npm test                                          # full suite
npm test -- workflow-scenario-matrix              # 49 phrase variants
npm test -- workflow-engine buyer-memory-extract buyerMemoryRecall action-helpers
npm run build
```

---

## 9. Master problem → fix registry

### 9.1 Solved issues (2026-06-06) — do not regress

| Problem | Symptom | Root cause | Fix | Layer | Version |
|---------|---------|------------|-----|-------|---------|
| Classifier puts property **name** in `propertyId` | `Invalid uuid` in buyer reply | No UUID sanitize | `sanitizeInvalidUuidFields` in `action-helpers.ts` | Workflow | 0.1.4 |
| “Push to next Sunday” not parsed | Reschedule fails “When should…” | `parseRescheduleTargetFromMessage` missing “push appointment to” | `visitIntentFromMessage.service.ts` | Intent | 0.1.5 |
| Discount routed to price catalog | Catalog instead of escalation | No negotiation bias | `detectBuyerNegotiationEscalationBias` | Intent | 0.1.6 |
| Internal workflow errors to buyer | `Workflow "brochure_request" failed…` | `runWorkflow` returned raw error | `buildBuyerWorkflowFailureReply` + `sanitizeBuyerWorkflowReply` | Workflow | 0.1.7 |
| Staff text in buyer reply | “Lead marked visit_scheduled” | Optional steps returned `ok(message)` | `updateLeadStatusVisitScheduled` → `skip()`; strip lines | Action | 0.1.7 |
| Qualify triggers catalog dump | Budget message → property list | Classifier → `price_inquiry` | `isBuyerQualificationOnlyMessage` + fast-path qualify | Routing | 0.1.9 |
| “My budget is…” triggers recall | Wrong path on statement | Regex too broad | `buyerMemoryRecall.service.ts` question-only pattern | Routing | 0.1.8 |
| `projectsDiscussed` pollution | “Visit scheduled”, “Amogh Sales” as projects | Bold-text extractor too greedy | Denylist in `buyer-memory-extract.service.ts` | Memory | 0.1.7 |
| Missing workflow telemetry | Only 2 action logs per 15 turns | No post-run log | `logAgentAction(workflow_${id})` on buyer complete/fail | Observability | 0.1.7 |
| First message connection fallback | Rapport → “technical issue” | LLM path failed | `isBuyerRapportMessage` deterministic welcome | Routing | 0.1.9 |
| Buyer LLM temperature **0.7** | Hallucination, invented errors | `BUYER_LLM_TEMPERATURE = 0` in `ai.service.ts` | Agent (LLM) | 0.1.10 |
| No JSON `response_format` on buyer LLM | Extra prose, schema drift | `response_format: json_object` + `parseAIResponse` JSON path | Agent | 0.1.10 |
| System prompt lacks buyer prohibitions | “Welcome” mid-thread, fake errors | `ai.service.ts` rules 8c–8d + `system-prompt.ts` | Prompt | 0.1.10 |
| Mid-thread context missing in prompt | Re-welcome after turn 2 | `RECENT CONVERSATION` block + 10-msg window | Memory + Agent | 0.1.10 |
| Message polish temp **0.3** | Drift from grounded facts | `temperature: 0` in `messagePolish.service.ts` | Agent | 0.1.10 |
| Premature escalate_to_human | Human handoff on weak signal | `ESCALATION_CONFIDENCE_THRESHOLD` 0.70 + clarify 0.65–0.70 | Intent | 0.1.10 |
| Staff copilot temp **0.1** | Non-deterministic tool routing | `AGENT_AI_TEMPERATURE` default 0; window 10 | Agent | 0.1.10 |
| Missing `leads(company_id, phone)` UNIQUE | Leads not created on prod | DB constraint | `bootstrapDatabase.ts` + migration scripts | Infra | pre-0.1.3 |

### 9.2 Open / known gaps (fix when symptom appears)

| Problem | Symptom | Fix target | Layer | Priority |
|---------|---------|------------|-------|----------|
| Saturday 4pm slot conflict | `agent_conflict`, 0 visits | Use dynamic slot in tests; suggest alternate in reply | Visit booking | P2 |
| Quick-reply buttons on workflow path | Extra buttons user didn’t ask for | Review `shouldAttachContextualQuickReplies` gates | UX | P2 |
| Brochure file missing on property (buyer) | Honest “no PDF in chat yet” + offer pricing/photos/team follow-up | `buyerStaffCopyGuard` + `brochure-tools` channel buyer | Code | shipped 2026-06-07 |
| Brochure file missing on property (ops) | Upload PDF in Properties listing | Admin UI | Content | ops |
| Takeover semantics ambiguous | AI replies after human escalation | Product decision `investo.md` Queue #17 | Policy | P2 |

### 9.3 Classic failure catalog (from production audits)

| Problem | Fix | Which layer |
|---------|-----|-------------|
| LLM hallucinates error messages | temperature=0; structured output; `buildBuyerWorkflowFailureReply` | Agent + Workflow |
| Multiple replies to one message | Webhook dedup; `claimOutboundAiReply`; idempotency keys | Webhook + Queue |
| “Welcome” mid-conversation | Inject last 5–10 messages; rapport fast-path only on turn 1 | Memory + Agent |
| Unnecessary escalation | Mutation threshold 0.80; clarify band 0.70–0.80; negotiation bias | Intent classifier |
| No response to “Okay I go with Lake Vista” | Workflow must return final message; propertyId from memory | Workflow + Memory |
| Catalog dump on qualify | Skip workflow on qualify-only; deterministic ack | Routing |
| Discount answered with price list | `detectBuyerNegotiationEscalationBias` before classifier | Intent |
| Reschedule creates duplicate visit | Buyer: in-place `bookBuyerVisit`; staff: cancelVisitSlot first | Workflow |
| Memory recall misses budget | `patchLeadMemoryFromQualification` before recall | Memory |

---

## 10. Twelve buyer scenarios (strict pass criteria)

**Runner:** `backend/scripts/buyer-scenario-runner.mjs`  
**Requires:** `scripts/.railway-prod-vars.json` (from `scripts/railway-fetch-vars.ps1`)

Use **one phone** for scenarios 1–12 in sequence (`$env:BUYER_PHONE='919000089xxx'`).

| # | Message | Must happen | Must NOT happen |
|---|---------|-------------|-----------------|
| 1 | Hi, looking for home in Bangalore | Lead created; welcome mentions Bangalore/help | Connection fallback |
| 2 | Budget 1.2–1.5 Cr, 3BHK Whitefield | `lead_memory.budget` + `locationPreference`; ack not catalog | Catalog dump |
| 3 | Send brochure for [property] | Brochure workflow log; honest PDF or upload msg | Internal error |
| 4 | What is price for 3BHK? | Grounded ₹/crore from catalog | Fake discount |
| 5 | Is 3BHK available this weekend? | Availability answer | Empty / error |
| 6 | Book visit next Sunday 11am | Visit row +1; `workflow_schedule_visit` log; confirmation | Staff leak text |
| 7 | Repeat #6 | Visits ≤ prior+1; idempotent reply | Duplicate visit |
| 8 | When is my visit? | Deterministic datetime + property | LLM guess |
| 9 | Push appointment to next Sunday | `workflow_reschedule_visit`; Sunday time in reply | “When should…” error |
| 10 | What’s my budget preference? | Recalls ₹1.20–1.50 crore from memory | Connection fallback only |
| 11 | Call me back, human agent | `workflow_escalate_to_human`; takeover message | Silent fail |
| 12 | 10% discount on final price? | Escalation; no catalog; no invented discount | price_inquiry catalog |

---

## 11. Memory architecture (single source of truth)

```
leads.lead_memory (JSON)
  ├─ budget { min, max, currency }
  ├─ locationPreference
  ├─ projectsDiscussed[] { propertyId?, name, factsShown[] }
  ├─ upcomingVisits[] { visitId, propertyName, scheduledAt, status }
  ├─ lastIntent
  └─ conversationSummary

Writes:
  • extractAndPatchLeadMemory (every buyer outbound)
  • patchLeadMemoryFromQualification (qualify fast-path)
  • syncLeadClientMemory → RAG vector (G2)

Reads:
  • buildPromptMemoryBlock → LLM injection
  • buildBuyerMemoryRecallReply → deterministic recall
  • enrichWorkflowParams → propertyId from projectsDiscussed
  • getLiveLeadContext → active visit for bias detectors
```

**Rule:** If buyer asks a **question** about memory → deterministic path. If buyer **states** a fact → patch memory, don’t trigger recall.

---

## 12. Visit lifecycle (buyer)

```
schedule_visit
  → bookBuyerVisit → scheduleVisit service
  → automationQueue visit_reminder_24h / _1h
  → lead status visit_scheduled (silent, not in buyer text)

reschedule_visit (active visit bias)
  → parseRescheduleTargetFromMessage
  → bookBuyerVisit updates same visit row
  → notifyVisitRescheduledFromTool

cancel_visit
  → visitMutationFromChat OR workflow cancelVisit

deterministic queries
  → isBuyerVisitStatusQuery → buildBuyerVisitStatusReply (no LLM)
```

**Context rule:** “later”, “push”, “move” with active visit = **reschedule**, not new booking.

---

## 13. What buyers must NEVER see

| Forbidden | Replacement |
|-----------|-------------|
| `Workflow "…" failed at step "…"` | `buildBuyerWorkflowFailureReply` |
| `propertyId: Invalid uuid` | UUID sanitize + catalog search |
| `Lead marked visit_scheduled` | `skip()` on staff-only steps |
| `Visit reminders scheduled.` | `skip()` — internal only |
| `I had a brief technical/connection issue` | Deterministic fast-path or real LLM answer |
| Invented % discount | `escalate_to_human` |
| Raw property UUID lines | `formatBuyerWorkflowReply` strips IDs |
| Second AI reply same turn | Dedup + early `return` after workflow |

---

## 14. What must ALWAYS happen

| Event | Required side effect |
|-------|---------------------|
| Buyer inbound (stranger) | Lead auto-create; `autoCreateLeadFromWhatsApp` log |
| Mutation workflow success | `workflow_run_records.status = completed` |
| Mutation workflow fail | `agent_action_logs.workflow_*` status failed + safe reply |
| Brochure sent / attempted | `workflow_brochure_request` log |
| Escalation | `takeoverConversation` + `notifyAllAgents` + fixed escalation copy |
| Visit booked | `visits` row; `lead_memory.upcomingVisits` |
| Qualify statement | `lead_memory.budget` + `locationPreference` without catalog |
| Outbound AI | Exactly **one** primary text per inbound (buttons optional, gated) |

---

## 15. Files cheat sheet (where to fix what)

| Concern | Primary file(s) |
|---------|-----------------|
| Buyer routing order | `whatsapp.service.ts` |
| Staff routing | `agent-router.service.ts`, `inboundWhatsAppRouting.service.ts` |
| Workflow classify + run | `workflow-engine.service.ts` |
| Workflow steps | `workflow-registry.ts`, `workflow/actions/*.ts` |
| UUID / param enrich | `workflow/actions/action-helpers.ts` |
| Date parsing | `visitIntentFromMessage.service.ts` |
| Visit book/reschedule | `visit-actions.ts`, `customerVisitBooking.service.ts` |
| Memory patch | `buyer-memory-extract.service.ts`, `lead-memory.service.ts` |
| Memory recall | `buyerMemoryRecall.service.ts` |
| Rapport / qualify | `buyerQualification.service.ts` |
| Buyer LLM / policy | `ai.service.ts`, `conversationStateMachine.ts` |
| Staff LLM / graph | `agent-graph.service.ts`, `agent-intent-orchestrator.service.ts` |
| Thresholds | `workflow.constants.ts` |
| Idempotency | `workflow-engine.service.ts` (`claimWorkflowExecution`) |
| Compensators / saga | `workflow-compensator.service.ts` |
| Action logs UI | `agent-action-log.service.ts`, dashboard routes |
| Handset tests | `scripts/buyer-scenario-runner.mjs`, `buyer-scenario-audit.mjs` |
| Prod DB bootstrap | `config/bootstrapDatabase.ts` |

---

## 16. Deploy & re-verify loop

```powershell
# 1. Tests local
cd backend && npm test && npm run build

# 2. Deploy Railway
$env:RAILWAY_ACCOUNT_TOKEN='<token>'
powershell -File scripts/deploy-railway-upload.ps1 -Message 'fix: <description> v0.1.x'

# 3. Health
curl.exe -s https://investo-backend-production.up.railway.app/api/health/live

# 4. Strict handset (fresh phone)
$env:BUYER_PHONE='9190000xxxxx'
npx tsx scripts/buyer-scenario-runner.mjs --all

# 5. Audit
npx tsx scripts/buyer-scenario-audit.mjs --phone 9190000xxxxx
# Exit code 0 = no INTERNAL_LEAK or CONNECTION_FALLBACK
```

---

## 17. Reverse-engineering checklist (global audit)

When “AI feels wrong” but you don’t know why:

1. **Pull the turn** — `buyer-scenario-audit.mjs --phone X` → read `turns[]` inbound/reply pairs.
2. **Check routing** — Which path fired? (workflow vs LLM vs fast-path). Grep logs for `classifyAndRunBuyerWorkflow`, `customerVisitBooked`, `workflow_`.
3. **Check workflow_run_records** — `failed_step`, `steps_json` for the timestamp.
4. **Check agent_action_logs** — Is `workflow_*` missing? → logging gap. Is `workflow_clarification` spurious? → threshold tune.
5. **Check lead_memory** — Did qualify write budget? Is `projectsDiscussed` polluted?
6. **Check visits table** — Duplicate rows? Wrong `scheduled_at` timezone (must be IST → UTC stored correctly)?
7. **Check classifier params** — `enrichWorkflowParams` output; propertyId valid UUID?
8. **Check temperature** — Buyer `ai.service.ts` still 0.7? → likely hallucination source.
9. **Fix smallest layer** — Prefer deterministic fast-path over prompt changes over new LLM calls.
10. **Re-run strict 12** — Not loose regex pass.

---

## 18. Version history (hygiene releases)

| Version | Date | Summary |
|---------|------|---------|
| 0.1.3 | 2026-06-06 | Prod DB bootstrap (lead unique, dedup, saga) |
| 0.1.4 | 2026-06-06 | UUID sanitize for workflow propertyId |
| 0.1.5 | 2026-06-06 | Reschedule date parsing (“push to Sunday”) |
| 0.1.6 | 2026-06-06 | Discount → escalate_to_human bias |
| 0.1.7 | 2026-06-06 | No internal errors to buyer; workflow action logs; memory denylist |
| 0.1.8 | 2026-06-06 | Memory recall regex fix (questions only) |
| 0.1.9 | 2026-06-06 | Deterministic rapport + qualification fast-paths |
| 0.1.10 | 2026-06-06 | Buyer temp=0, JSON replies, conversation history injection, escalation thresholds, prompt prohibitions |

---

## 19. One-page emergency triage

```
Buyer saw internal error     → §9.1 sanitize/buildBuyerWorkflowFailureReply; redeploy ≥0.1.7
Duplicate visit              → §5 idempotency; check claimWorkflowExecution
No visit on book             → agent_conflict? steps_json bookVisit; try Sunday 11am slot
Catalog on qualify/discount  → §3 routing order; negotiation/qualify bias
Connection issue message     → §3 step 5–7 fast-paths; fix ai.service temperature
Staff saw wrong data         → agent-router tool call logs; viewer read-only?
Nothing logged               → agent_action_logs workflow_* ; enable inbound_message trigger
```

**When in doubt:** run audit script, read `turns[]`, fix the **earliest** wrong layer in the routing chain, redeploy, re-run 12 scenarios strict.

---

*This document is the operational source of truth. Update §9.1 and §18 when fixing production AI issues.*
