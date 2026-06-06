# Investo — A+ AI & Agentic WhatsApp Implementation Plan

> **Purpose:** Audit the **entire codebase once**, define how Investo **should** work (algorithms, architecture), then fix **one gap at a time**: compare → fix → recheck → test → next. Loop until buyer + staff WhatsApp AI reaches **A+**.  
> **Scope:** Full codebase audit, ideal target design, gap-driven iteration, exhaustive validation.  
> **Status:** Plan — execution starts with Audit Item #1 below.  
> **Last updated:** 2026-06-06  
> **Companion (proof & grades):** [`backend/docs/AI_MASTER_REALITY_AND_A_PLUS_PLAN.md`](backend/docs/AI_MASTER_REALITY_AND_A_PLUS_PLAN.md)

---

## How to use this document

1. Run **§3 Full codebase audit** once → produce gap report.
2. Work **§4 Sequential fix queue** from **#1** — never skip ahead until current item passes recheck + tests.
3. After each item: run **§5 Test matrix** → update grades in master reality doc → pick next item.
4. Repeat until **§6 A+ gate** is green.

```
AUDIT (once) → [#1 compare → fix? → recheck → test] → [#2 …] → … → A+
```

---

## 1. Current state snapshot

| Surface | Grade | Key gaps |
|---------|-------|----------|
| Buyer WhatsApp AI | **B** | Memory not unified; saga partial; no handset proof; clarification not logged |
| Staff WhatsApp Copilot | **B+** | No dashboard AI; `viewer` excluded; LangGraph fallback not prod-proven |
| Dashboard | **D** | No AI chat; action logs yes; no per-lead memory panel |
| Proactive automation | **A** | Templates — not LLM-agentic |
| Property import AI | **A** | Out of WhatsApp scope |

**Production (biginvesto.online):**

| Layer | URL |
|-------|-----|
| Frontend | https://biginvesto.online |
| Backend | https://investo-backend-production.up.railway.app/api |
| Legacy (do not use for new proof) | https://investo-backend-v2.onrender.com/api |

**Algorithms in production today:**

| Layer | Algorithm | Location |
|-------|-----------|----------|
| Ingress dedup | DB fingerprint + Redis lock | `inboundMessageGuard.service.ts` |
| Identity routing | Phone → company user role | `inboundWhatsAppRouting.service.ts` |
| Fast-path router | Regex + DB (visits, CRM) | `customerVisitBooking`, `agent-crm-query`, `buyerVisitQuery` |
| Workflow classifier | LLM temp 0.05, threshold 0.62 | `workflow-engine.service.ts` |
| Mutation guard | Threshold 0.75, clarification band 0.65–0.75 | `workflow.constants.ts` |
| Active-visit bias | Rule-based pre-classifier | `detectActiveVisitMutationBias()` |
| Policy brain | Conversation stage FSM | `conversationStateMachine.ts` |
| Language brain | LLM + RAG embeddings | `ai.service.ts`, `clientMemory.service.ts` |
| Staff intents | Classify → extract → execute (~50 intents) | `agent-intent-orchestrator.service.ts` |
| Agentic fallback | LangGraph tool-calling | `agent-graph.service.ts` |
| Workflow execution | 15 workflows × 45+ actions | `workflow-engine.service.ts`, `actions/` |
| Saga | Step snapshots + compensators (partial) | `workflow-compensator.service.ts` |
| Idempotency | Redis/DB keys, 24h TTL | `claimWorkflowExecution()` |
| Memory (fragmented) | 8 stores — see §2.1 | `lead_memory`, RAG, stage, live ctx, etc. |

**Biggest debt:** Memory split across 8 stores; no single source of truth; RAG not synced after every buyer patch.

---

## 2. How Investo should work (A+ target)

### 2.1 Single unified memory (“one brain”)

**Rule:** `leads.lead_memory` (JSONB) is the **only** source of truth.

Every buyer and staff turn **must** write via a memory update service. RAG vectors are **derived asynchronously** from `lead_memory` — never a competing truth.

```json
{
  "version": 1,
  "projectsDiscussed": [{ "propertyId": "…", "name": "Lake Vista", "factsShown": ["price"] }],
  "budget": { "min": 12000000, "max": 15000000, "currency": "INR" },
  "locationPreference": "Whitefield",
  "preferredBhk": "3",
  "upcomingVisits": [{ "visitId": "…", "propertyName": "Lake Vista", "scheduledAt": "2026-06-10T16:00:00Z" }],
  "pastVisits": [],
  "openQuestions": [],
  "conversationSummary": "Wants 3BHK under 1.5 Cr in Whitefield.",
  "lastIntent": "brochure_request",
  "lastUpdated": "2026-06-06T10:00:00Z"
}
```

**Read path:** `buildPromptMemoryBlock(leadId)` for buyer AI + staff `invokeAgent`.  
**Write path:** `extractAndPatchLeadMemory` (buyer) + `patchLeadMemory` (staff) → `syncLeadClientMemory(leadId)` within 60s.

Conversation stage, live context, and client chunks become **views** derived at read time — not separate truths.

---

### 2.2 Message processing algorithm (buyer + staff)

Every inbound WhatsApp message follows this **strict order**:

```
1. ACK webhook (200 immediately)
2. Dedup claim (inbound_whatsapp_dedup + Redis)
3. Identity route (buyer | copilot | static staff notice)
4. SHORT-CIRCUIT LAYER (no LLM):
   - Interactive button / list / location reply
   - Pending confirmation YES/NO
   - Deterministic visit-status query
   - Deterministic CRM (staff: visits today, new leads today, etc.)
   - Visit fast-path parse (buyer: tryCommitCustomerVisitBooking)
5. ACTIVE-CONTEXT BIAS (buyer mutations only):
   - If activeVisit exists → bias reschedule/cancel before classifier
6. WORKFLOW CLASSIFIER (LLM temp = 0.0–0.05):
   - confidence ≥ mutation threshold (0.80 target / 0.75 today) → execute
   - confidence in clarification band → ask + LOG workflow_clarification
   - confidence < floor → fall through
7. WORKFLOW EXECUTION (atomic saga):
   - claimWorkflowExecution(idempotencyKey)
   - snapshot state before each mutation step
   - on failure → compensate reverse order OR needs_reconciliation + alert
8. INTENT ORCHESTRATOR (staff only, if workflow null)
9. LANGGRAPH (staff only, last resort, confidence < 0.50 path)
10. POLICY + LANGUAGE BRAIN (buyer fallback: aiService.generateResponse)
11. MEMORY WRITE (every outbound):
    - patchLeadMemory(delta)
    - syncLeadClientMemory (async)
12. ACTION LOG (every autonomous step)
13. OUTBOUND send + dedup
```

---

### 2.3 Workflow classifier parameters (target A+)

| Workflow type | Execute threshold | Clarification band | LLM temperature |
|---------------|-------------------|--------------------|-----------------|
| Mutations (`schedule_visit`, `reschedule_visit`, `cancel_visit`) | **≥ 0.80** | **0.70 – 0.80** | **0.0** |
| Queries (price, brochure, availability, amenities) | **≥ 0.65** | 0.55 – 0.65 | **0.0** |
| Staff CRM workflows | **≥ 0.62** (today) → tighten to 0.70 | per workflow | **0.0** |

**Clarification rule:** Never write DB on clarification band — always log:

```ts
{ action: 'workflow_clarification', inputs: { message, workflowId, confidence, alternatives } }
```

---

### 2.4 Atomic saga algorithm

For every mutation workflow:

```
workflowRunId = uuid()
for each step in workflow:
  if step.isMutation:
    snapshot = captureState(lead, visit)
  result = await execute(step)
  if failed:
    for compensator in reverse(completedMutations):
      await compensator(snapshot)
    if any compensator failed:
      status = needs_reconciliation
      notifyAdmin()
    log(action: 'workflow_compensation')
    return honestUserMessage()
mark workflowRun completed
cache idempotency result (24h)
```

**Idempotency key:** `hash(workflowId + leadId + normalizedParams)` — duplicate → return cached reply, **no** second DB write.

---

### 2.5 Role matrix (zero-UI target)

| Role | WhatsApp | Dashboard |
|------|----------|-----------|
| Buyer (unknown phone) | Full AI + buttons | N/A |
| `sales_agent`, `admin`, `ops` | Full copilot | Copilot chat (same backend) |
| `viewer` | **Read-only** copilot (no writes) | Read-only copilot |
| `company_admin` | Copilot + audit | Action logs + memory panel |

---

### 2.6 LangGraph — last resort only

Invoke only when: workflow classifier < 0.50 **and** intent orchestrator returns null (staff).  
Every tool call → `agent_action_logs` with inputs + result.

---

### 2.7 Proactive agentic (Phase G+)

Reminders/follow-ups generated from `lead_memory` + summary via LLM — not static templates only.

---

### 2.8 Observability (A+)

- Every autonomous action in `agent_action_logs`
- Dashboard: **AI Action Logs** (shipped), **What AI knows** (per lead), **Decision trace** (classifier confidence per message)

---

## 3. Full codebase audit (run once)

### 3.1 Automated audit (PowerShell, from repo root)

```powershell
# Save output:
$date = Get-Date -Format 'yyyy-MM-dd'
$auditDir = "docs/audits"
New-Item -ItemType Directory -Force -Path $auditDir | Out-Null
$out = "$auditDir/audit-$date.md"
"# Investo codebase audit $date" | Out-File $out

function Audit-Section($title, $pattern, $path = "backend/src") {
  "`n## $title`n" | Add-Content $out
  rg -n $pattern $path --glob "*.ts" 2>&1 | Add-Content $out
}

Audit-Section "Memory stores" "lead_memory|leadMemory|liveLeadContext|conversation_stage|client_memory|agent_sessions|patchLeadMemory|syncLeadClientMemory"
Audit-Section "Direct LLM bypass" "openai\.|chat\.completions|anthropic"
Audit-Section "Workflow compensators" "compensat|needs_reconciliation|runCompensation"
Audit-Section "Idempotency" "claimWorkflowExecution|buildWorkflowIdempotencyKey|workflow_idempotency"
Audit-Section "Clarification logging" "workflow_clarification|CLARIFICATION_BAND|pendingClarification"
Audit-Section "Action logs" "agent_action_logs|logAgentAction|createActionLog"
Audit-Section "Buyer memory hooks" "extractAndPatchLeadMemory"
Audit-Section "Dashboard copilot" "copilot\.routes|/api/copilot"
Audit-Section "Routing entry" "handleIncomingMessage|routeCompanyScopedInbound|handleAgentMessage"

Write-Host "Audit written to $out"
```

### 3.2 Manual audit checklist

| # | Area | Verify | Primary file |
|---|------|--------|--------------|
| M1 | Message routing order | Same short-circuit chain for all buyer messages | `whatsapp.service.ts` |
| M2 | Staff routing order | confirmations → CRM → workflow → intent → graph | `agent-router.service.ts` |
| M3 | Memory write buyer | Every outbound calls `extractAndPatchLeadMemory` | `whatsapp.service.ts` |
| M4 | Memory write staff | Copilot exchanges patch `lead_memory` | `agent-router.service.ts` |
| M5 | RAG sync | `syncLeadClientMemory` after buyer patch | `buyer-memory-extract.service.ts` |
| M6 | Compensators | All mutation workflows have rollback | `workflow-compensator.service.ts` |
| M7 | Clarification logs | `workflow_clarification` exists | `workflow-engine.service.ts` |
| M8 | Idempotency before mutate | `claimWorkflowExecution` before `runWorkflow` loop | `workflow-engine.service.ts` |
| M9 | Dashboard copilot | `POST /api/copilot/chat` | should exist — **currently missing** |
| M10 | Handset matrix | 12 scenarios on prod phone | manual — **baseline empty** |

### 3.3 Gap report template

After audit, fill:

| Gap ID | Deviation from §2 | Severity | Effort | Queue # |
|--------|-------------------|----------|--------|---------|
| G1 | 8 memory stores not unified (RAG now synced after buyer+staff patch; stage/live ctx still separate) | P0 | 24h | #3 ✅ #4 ✅ |
| G2 | RAG stale after buyer patch | P0 | 2h | #3 ✅ |
| G5 | Clarification not logged | P1 | 4h | #5 ✅ |
| G3 | Saga not prod-proven on handset | P0 | 8h | #6 ✅ unit; handset #11 open |
| G4 | Idempotency not prod-proven | P0 | 4h | #7 |
| G6 | No live handset matrix baseline | P0 | 4h | #8 script ✅; rows open |
| G8 | Prod smoke targeted Render | P1 | 1h | #1 ✅ |
| G9 | Mail SMTP down on Railway | P1 | 2h | #2 (needs Railway secrets) |
| G10 | Dashboard copilot missing | P2 | 16h | #14 ✅ #15 ✅ |
| G12 | viewer excluded from WhatsApp AI | P3 | 4h | #13 ✅ |
| G14 | Per-lead memory panel missing | P1 | 4h | #12 ✅ |

---

## 4. Sequential fix queue (one at a time)

**Rule per item:** `COMPARE` (code vs §2) → `FIX` (if mismatch) → `RECHECK` (audit grep + unit) → `TEST` (§5) → `MARK DONE` → next.

Only move to **N+1** when item **N** is ✅.

| # | Item | Compare (ideal) | Fix target | Recheck | Test gate |
|---|------|-----------------|------------|---------|-----------|
| **1** | Prod smoke targets Railway | All scripts/curl use Railway URL | `verify-workflow-scenarios-production.ps1`, docs | curl health Railway | §5.2 smoke | ✅ 2026-06-06 |
| **2** | Mail SMTP on prod | `health.dependencies.mail.status: ok` | Railway env / SES | `GET /api/health` | §5.2 | ✅ 2026-06-06 (SES ok) |
| **3** | RAG sync after buyer memory | `patchLeadMemory` → `syncLeadClientMemory` | `buyer-memory-extract.service.ts` | rg sync call | `buyer-memory-extract` + §5.1 | ✅ 2026-06-06 |
| **4** | Staff memory write-back | Staff turns patch `lead_memory` | `agent-router.service.ts` | rg patchLeadMemory staff path | agent tests + §5.1 | ✅ 2026-06-06 |
| **5** | Clarification logging | `workflow_clarification` in action logs | `workflow-engine.service.ts` | rg workflow_clarification | workflow-engine tests | ✅ 2026-06-06 |
| **6** | Saga integration test | Fail send → compensate or reconcile | compensator + engine tests | npm test compensator | §5.1 + handset #11 | ✅ 2026-06-06 |
| **7** | Idempotency prod proof | Duplicate book → one visit | verify idempotency key path | unit + DB query script | handset #3 | ⚠️ webhook #3 HTTP 200; DB COUNT blocked |
| **8** | Handset baseline | Run 12 scenarios, record failures | `run-handset-matrix-prod.ps1` + §5.3 | fill §5.3 table | `A_PLUS_PROOF.md` §6 | ⚠️ 2026-06-06 webhook partial |
| **9** | Fix handset failures #1–#6 | Buyer memory + visits | per gap report | re-run rows | §5.3 buyer rows |
| **10** | Fix handset failures #7–#9 | Staff copilot | per gap report | re-run rows | §5.3 staff rows |
| **11** | E2E Playwright | Login + action logs page | CI secrets + e2e spec | npm run test:e2e | §5.1 green |
| **12** | Per-lead memory panel | UI shows `lead_memory` | lead detail frontend | manual UI | admin UI check | ✅ 2026-06-06 |
| **13** | Viewer read-only copilot | No “use dashboard” wall | `inboundWhatsAppRouting.service.ts` | role test | handset viewer | ✅ 2026-06-06 |
| **14** | Dashboard copilot API | `POST /api/copilot/chat` | new route + router reuse | API test | §5.1 | ✅ 2026-06-06 |
| **15** | Dashboard copilot UI | `/dashboard/copilot` | frontend chat component | e2e | handset #10 updated | ✅ 2026-06-06 |
| **16** | LLM proactive reminders | Memory-aware follow-ups | `automation.service.ts` | unit + cron | optional Phase G |
| **17** | Takeover semantics | Product decision + code | `whatsapp.service.ts` + UI | §5.3 row 12 | `A_PLUS_PROOF.md` §6.1 interim | ⚠️ sign-off pending |
| **18** | Final A+ validation | All gates green | — | full §5 | `A_PLUS_PROOF.md` §7 | ❌ FAIL 2026-06-06 (B+ not A+) |

---

## 5. Complete test matrix (run after every fix)

### 5.1 Automated (must be 100% green)

```powershell
cd backend
npm test                                          # 663+ unit tests
npm test -- workflow-scenario-matrix              # 49+ workflow phrases
npm test -- buyer-memory-extract agent-action-log workflow-engine
npm test -- agent-intent agent-crm visitIntent visitMutation agent-router.workflow
npm run build

cd ..\frontend
npm test                                          # 75+ tests
npm run build

# E2E (when #11 done):
cd frontend
npm run test:e2e
```

**Last known:** backend **678/678 PASS** (113 suites, 2026-06-06). Frontend **75/75 PASS**.

### 5.2 Production smoke (Railway)

```powershell
$base = "https://investo-backend-production.up.railway.app"
curl.exe -s "$base/api/health/live"
curl.exe -s -o NUL -w "agent-action-logs: %{http_code}`n" "$base/api/agent-action-logs"
curl.exe -s "$base/api/health" | findstr mail
.\scripts\verify-workflow-scenarios-production.ps1   # must target Railway after #1
```

### 5.3 Handset acceptance (12 scenarios — A+ gate)

Run on **real WhatsApp** against **Railway production**. Fill **Result** after each loop.

| # | Actor | Message | Pass criteria | Date | Result |
|---|-------|---------|---------------|------|--------|
| 1 | Buyer | Send brochure for [project] | Brochure sent; `lead_memory.projectsDiscussed` updated | 2026-06-06 | ⚠️ webhook HTTP 200 only |
| 2 | Buyer | Book visit Saturday 4pm | One visit; confirmation; `upcomingVisits` | 2026-06-06 | ⚠️ webhook HTTP 200 only |
| 3 | Buyer | Repeat #2 (new message_id) | Idempotent; **one** visit row | 2026-06-06 | ⚠️ HTTP 200; DB COUNT blocked |
| 4 | Buyer | Active visit + “push to Sunday” | Reschedule or clarification; no duplicate | 2026-06-06 | ⚠️ webhook HTTP 200 only |
| 5 | Buyer | State budget, then “what’s my budget?” | Recalls from memory | 2026-06-06 | ⚠️ HTTP 200/200; memory not verified |
| 6 | Buyer | “When is my visit?” | Deterministic datetime | 2026-06-06 | ⚠️ webhook HTTP 200 only |
| 7 | Staff | “Visits today” | Visit list | 2026-06-06 | ⚠️ synthetic staff phone |
| 8 | Staff | “Update lead [x] status to visited” | Status + action log | 2026-06-06 | ⚠️ webhook HTTP 200 only |
| 9 | Staff | `AGENT_AI_LLM_ENABLED=false`, repeat #8 | Deterministic CRM works | 2026-06-06 | ❌ env toggle blocked |
| 10 | Admin | Open `/dashboard/ai-action-logs` | Recent actions visible | 2026-06-06 | ⚠️ SPA HTTP 200; no auth data |
| 11 | System | Inject confirmation send failure | `needs_reconciliation` + notify | 2026-06-06 | ❌ dev-only |
| 12 | Buyer | Takeover then inbound | Per product decision (§2.5 / #17) | 2026-06-06 | ❌ blocked; interim §6.1 in A_PLUS_PROOF |

**A+ gate:** All 12 ✅ — **NOT MET** (0/12 full; see `docs/A_PLUS_PROOF.md` §6–§7).

### 5.4 DB proof queries (after handset)

```sql
SELECT lead_memory FROM leads WHERE phone = '<buyer_phone>';
SELECT id, action, status, inputs FROM agent_action_logs
  WHERE company_id = '<company_id>' ORDER BY created_at DESC LIMIT 20;
SELECT COUNT(*) FROM visits WHERE lead_id = '<lead_id>' AND scheduled_at = '<slot>';
```

---

## 6. A+ success criteria

| Principle | A+ requirement | Proof |
|-----------|----------------|-------|
| Unified memory | Single `lead_memory`; no repeat questions 5 turns | Handset #5 |
| Idempotent mutations | Duplicate book → one row | Handset #3 |
| Atomic saga | Failure → rollback or `needs_reconciliation` | Handset #11 |
| Clarification logged | Every low-confidence mutation logged | DB query `workflow_clarification` |
| Fast-path | Visit status never hits LLM | Logs / mock proof |
| Staff all roles | Viewer read-only copilot | Queue #13 |
| Dashboard parity | Browser copilot = WhatsApp | Queue #14–15 |
| Handset matrix | 12/12 prod | §5.3 |
| Automated CI | 100% pass | §5.1 |

**Composite grade target:** Buyer **A+**, Staff WhatsApp **A+**, Dashboard agentic **A**.

---

## 7. Phased timeline (parallel to §4 queue)

| Phase | Weeks | Focus | Exit |
|-------|-------|-------|------|
| **A** | 1 | Audit + infra (#1–2, #8) | Gap report; Railway smoke; mail ok |
| **B** | 2 | Memory (#3–4, #12) | Handset #1, #2, #5 |
| **C** | 2 | Saga + idempotency (#6–7) | Handset #3, #11 |
| **D** | 1 | Intent + telemetry (#5, #9) | Handset #4, #8; clarification in logs |
| **E** | 1 | Staff (#10, #13) | Handset #7, #9 |
| **F** | 2 | Dashboard copilot (#14–15) | Handset #10; browser parity |
| **G** | 1 | Final (#17–18) | 12/12 handset; grade A+ |

**Estimate:** 10 weeks full-time · 20 weeks part-time.

---

## 8. Weekly loop (never stop)

```
Monday:   Pick highest open # from §4
          COMPARE codebase vs §2 for that item
Tue–Wed:  FIX + unit tests
Thu:      Deploy Railway (deploy-railway-backend.ps1 or deploy-railway-upload.ps1)
          Run §5.1 + §5.2
Fri:      Handset scenarios affected by this fix
          Update gap report + AI_MASTER_REALITY grades
          If grade < A+ → next #
```

After **A+:** monthly handset regression + full §5.1 on every AI-touching PR.

---

## 9. Immediate first steps (start at #1)

- [x] Run §3.1 automated audit → `docs/audits/audit-2026-06-06.md`
- [x] Complete §3.2 manual checklist → gap report table (§3.3)
- [x] **Queue #1:** Repoint prod verification to Railway
- [ ] **Queue #2:** Fix mail SMTP on Railway (documented blocker — needs SMTP env vars)
- [x] **Queue #8:** Handset matrix script created (`scripts/verify-ai-handset-matrix.ps1`)
- [x] Run §5.1 automated suite (**678** backend + **75** frontend PASS 2026-06-06)

---

## 10. Deploy commands (each loop)

```powershell
# Git redeploy (account token):
$env:RAILWAY_TOKEN = '<account-token>'
.\scripts\deploy-railway-backend.ps1

# Local upload (uncommitted changes):
$env:RAILWAY_ACCOUNT_TOKEN = '<account-token>'
.\scripts\deploy-railway-upload.ps1

# Frontend:
cd frontend
npx vercel deploy --prod --yes
```

---

## 11. What not to claim until §6 is green

- “AI never double-books”
- “AI remembers everything”
- “Every failure auto-rolls back”
- “Fullest / extreme / A+ agentic experience”
- “Staff have AI in the dashboard” (until #14–15 done)

**Safe today:** Core WhatsApp flows work; 663 unit tests + 49 workflow phrases; action logs API live; composite grade **~B**.

---

## 12. Document map

| File | Role |
|------|------|
| **`investo.md` (this file)** | Execution plan: audit once → fix queue #1…#18 → test loop |
| [`backend/docs/AI_MASTER_REALITY_AND_A_PLUS_PLAN.md`](backend/docs/AI_MASTER_REALITY_AND_A_PLUS_PLAN.md) | Grades, proof matrix, gap ledger |
| [`backend/docs/ai.md`](backend/docs/ai.md) | Ideal buyer behavior spec |
| [`backend/docs/ai-reality-check-and-roadmap.md`](backend/docs/ai-reality-check-and-roadmap.md) | Architecture deep dive |
| [`backend/docs/ai-implementation-plan.md`](backend/docs/ai-implementation-plan.md) | Historical gap tracker |

---

> **Investo reaches A+ not by guessing, but by auditing every line, comparing to §2, fixing one gap at a time, and proving each fix with §5 before moving on.**

**Start at Queue #1. Update this file after every item.**

ompare if no fix , then recheck ,test (all test you mentioned babove ) then next (# Investo AI & Agentic WhatsApp – A+ Implementation Master Plan

> **Purpose:** One document to **audit, redesign, rebuild, and loop** until Investo’s WhatsApp AI (buyer + staff) achieves the **fullest, most extreme, A+ agentic experience**.  
> **Scope:** Complete codebase audit, ideal architecture definition, gap-driven iterative fixes, and exhaustive testing.  
> **Last updated:** 2026-06-06  
> **Status:** Plan – not yet executed.

---

## 1. Current State Snapshot (from master reality doc)

| Surface | Grade | Key Gaps |
|---------|-------|----------|
| Buyer WhatsApp AI | B | Memory not unified; saga rollback partial; no handset validation; clarification not logged |
| Staff WhatsApp Copilot | B+ | No dashboard AI; viewer role excluded; LangGraph fallback not prod‑proven |
| Dashboard | D | No AI chat; action logs exist but no per‑lead memory panel |
| Proactive automation | A | Templates only – not agentic |
| Property import AI | A | Out of WhatsApp scope |

**Core algorithms in use:**
- Intent classification (5 classifiers, thresholds 0.55–0.75)
- Workflow engine (15 workflows, 45+ actions)
- Policy brain (state machine for buyer conversation stage)
- LLM + RAG for generative responses
- LangGraph for staff fallback
- Multi‑store memory (lead DB, lead_memory JSON, RAG vectors, conversation stage, live context, summary, staff session, LangGraph checkpoint)

**Biggest architectural debt:** Memory fragmented across 8 stores; no unified source of truth.

---

## 2. Ideal Target Architecture (A+ Definition)

### 2.1 Single Unified Memory (The “One Brain”)
- **Only one source of truth:** `leads.lead_memory` (JSONB).
- Every turn (buyer or staff) writes to it via a **memory update service**.
- RAG vectors are derived **asynchronously** from `lead_memory` – never stale.
- **Memory schema:**
  ```json
  {
    "projects_discussed": ["Lake Vista", "Sunset Heights"],
    "budget_range": "1.2-1.5 Cr",
    "preferred_bhk": "3",
    "upcoming_visits": [{"project": "Lake Vista", "datetime": "2026-06-10T16:00:00"}],
    "past_visits": [],
    "open_questions": ["What is the maintenance cost?"],
    "conversation_summary": "User wants a 3BHK under 1.5 Cr in Whitefield.",
    "last_updated": "2026-06-06T10:00:00Z"
  }
  ```
- **No** separate conversation stage, live context, or client memory chunks – all derived from `lead_memory` at read time.

### 2.2 Deterministic Short‑Circuit First
- Every message goes through a **fast‑path router** (regex + DB) for:
  - Visit status queries
  - Simple confirmations (Yes/No)
  - Button/location replies
  - Known deterministic staff commands (`visits today`, `new leads today`)
- Only if no match → proceed to workflow classifier.

### 2.3 Workflow Classifier – High Precision, Low Temperature
- LLM temp = 0.0 (deterministic).
- Confidence thresholds:
  - **Mutations** (schedule/reschedule/cancel) → threshold 0.80, with clarification band 0.70–0.80.
  - **Queries** (price, brochure, availability) → threshold 0.65.
- **Clarification** is **always logged** to `agent_action_logs` with `action = 'workflow_clarification'`, storing original message, confidence, and alternatives considered.

### 2.4 Workflow Execution – Atomic Saga
- Each workflow is a **distributed transaction** with:
  - **Compensating actions** for every step.
  - **Idempotency key** derived from `lead_id + workflow_name + parameters_hash` (24h TTL in Redis).
  - If any step fails:
    - Execute all compensating actions in reverse order.
    - Mark visit/lead with `needs_reconciliation = true`.
    - Insert `workflow_compensation` action log.
    - Notify admin via action log + optional WhatsApp alert.
- Result: **No partial state** – either fully applied or fully undone.

### 2.5 Zero‑UI for All Roles
- **Buyer:** Natural language + interactive buttons + flows (optional).
- **Staff (sales_agent, admin, ops):** WhatsApp slash commands + natural language + contextual shortcuts.
- **Viewer:** Read‑only WhatsApp copilot (no writes) – no “use dashboard” wall.
- **Dashboard:** Full AI copilot parity (same backend as WhatsApp) – `/api/copilot/chat` endpoint reused in a chat UI component.

### 2.6 LangGraph as Last Resort Only
- Invoked only after workflow classifier confidence < 0.50 and intent orchestrator fails.
- Tools are strictly role‑scoped.
- Every tool call is logged with input/output.

### 2.7 Proactive AI (Agentic, Not Just Template)
- Reminders and follow‑ups are **generated by LLM** using `lead_memory` and recent conversation summary.
- Example: *“You mentioned you liked Lake Vista’s pool. Would you like to schedule a visit this weekend?”* – not a static template.

### 2.8 Full Observability
- Every autonomous action (workflow, tool call, clarification, compensation) in `agent_action_logs`.
- Dashboard panel: **“What AI knows about this lead”** – renders `lead_memory` JSON + a timeline of memory changes.
- Dashboard panel: **“AI decision trace”** – shows classifier result, confidence, and reasoning for each message.

---

## 3. Audit Process – Complete Codebase at Once

### 3.1 Automated Audit Scripts
Run these from the project root:

```powershell
# 1. Find all memory stores
Write-Host "=== Memory Store Usage ==="
grep -r "conversation_stage\|liveLeadContext\|client_memory_chunks\|agent_sessions\|lead_memory" --include="*.ts" backend/src

# 2. Find direct LLM calls bypassing workflow
Write-Host "=== Direct LLM invocations ==="
grep -r "openai.chat\|anthropic.messages" --include="*.ts" backend/src | findstr /v "workflow\|classifier"

# 3. Find workflow steps without compensation
Write-Host "=== Workflow steps without compensation ==="
grep -r "execute: async" backend/src/workflows -A 20 | findstr /v "compensator\|rollback"

# 4. Find missing idempotency keys
Write-Host "=== Idempotency key usage ==="
grep -r "workflowIdempotency\|claimWorkflowExecution" --include="*.ts" backend/src

# 5. Find places where agent_action_logs missing
Write-Host "=== Action logs audit ==="
grep -r "agent_action_logs" --include="*.ts" backend/src --count
```

### 3.2 Manual Audit Checklist (Human)

| Area | What to verify | File location hint |
|------|----------------|---------------------|
| **Message routing** | Does every inbound message hit the same short‑circuit chain? | `whatsapp.service.ts` |
| **Memory writes** | Is `lead_memory` updated on every buyer turn? Every staff turn? | `buyer-memory-extract.service.ts`, `agent-router.service.ts` |
| **Workflow compensators** | Do `schedule_visit`, `reschedule_visit`, `cancel_visit` have full rollback? | `workflow-compensator.service.ts` |
| **Clarification logging** | Is there any `workflow_clarification` action in the codebase? | `workflow-engine.service.ts` |
| **Idempotency** | Is `claimWorkflowExecution` called before every mutation workflow? | `workflow-engine.service.ts` |
| **RAG sync** | After `patchLeadMemory`, is `syncLeadClientMemory` called? | `buyer-memory-extract.service.ts` |
| **Dashboard copilot** | Does `POST /api/copilot/chat` exist? | `copilot.routes.ts` (should exist) |
| **Handset matrix** | Has any real phone run the 12 acceptance scenarios? | Manual record |

### 3.3 Audit Output

After running the audit, produce a **Gap Report** with:
- List of all deviations from the ideal architecture.
- Severity (P0, P1, P2).
- Estimated fix effort (hours).

Example:  
| Gap | Severity | Effort | Fix |
|-----|----------|--------|-----|
| Memory not unified (8 stores) | P0 | 40h | Phase B |
| No workflow clarification logging | P1 | 8h | Phase D |
| Dashboard copilot missing | P2 | 80h | Phase F |

---

## 4. Gap-Driven Iterative Loop (Build → Test → Prove → Fix → Repeat)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Start: Audit & Gap Report                    │
└─────────────────────────────┬───────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Loop iteration (weekly):                                      │
│   1. Pick highest priority gap (P0 > P1 > P2)                  │
│   2. Implement fix (code + unit tests + integration tests)     │
│   3. Deploy to Railway (staging or production branch)          │
│   4. Run full test matrix (see section 5)                      │
│   5. Run handset acceptance scenarios (see section 6)          │
│   6. If any test fails → rollback, fix, goto 2                 │
│   7. Update gap report, mark gap closed                        │
│   8. Re-grade overall system (section 7)                       │
│   9. If grade < A+, continue loop                              │
└─────────────────────────────────────────────────────────────────┘
```

**Commitment:** Do not ship any new feature outside this loop until A+ is reached.

---

## 5. Complete Test Matrix (Run Every Loop)

### 5.1 Automated Tests (Must Pass 100%)

| Category | Command | What it covers |
|----------|---------|----------------|
| Unit tests | `cd backend && npm test` | 663+ tests – all functions |
| Workflow scenario matrix | `npm test -- workflow-scenario-matrix` | 49+ phrase → expected workflow |
| Memory extract tests | `npm test -- buyer-memory-extract` | P1 extraction rules |
| Idempotency tests | `npm test -- idempotency` | Duplicate workflow calls |
| Compensator tests | `npm test -- compensator` | Rollback on failure |
| Integration tests (API) | `npm test -- integration` | Webhook, action logs, health |
| Frontend unit | `cd frontend && npm test` | 75+ tests |
| E2E Playwright | `npm run test:e2e` | Login + action logs page |

### 5.2 Production Smoke (Railway)

| Test | Script/Manual | Pass criteria |
|------|---------------|---------------|
| Health check | `curl /api/health/live` | 200 OK |
| Action logs auth | `curl /api/agent-action-logs` | 401 (no token) |
| Webhook scenario script | `.\scripts\verify-workflow-scenarios-production.ps1` (repointed to Railway) | All PASS |
| Mail SMTP | `curl /api/health` | `mail.status: ok` |

### 5.3 Handset Acceptance Matrix (12 scenarios)

Run on **real WhatsApp phone** against **Railway production**. Record date and result.

| # | Actor | Message | Pass criteria | Prod handset date | Result |
|---|-------|---------|---------------|-------------------|--------|
| 1 | Buyer | “Send brochure for Lake Vista” | Brochure sent; `lead_memory.projects_discussed` contains “Lake Vista” | | |
| 2 | Buyer | “Book visit Saturday 4pm at Lake Vista” | One visit created; confirmation received; `upcomingVisits` in memory | | |
| 3 | Buyer | Same as #2 (new message_id) | Idempotent reply; **still one visit row** | | |
| 4 | Buyer | After active visit: “push to Sunday” | Reschedule or clarification; no duplicate | | |
| 5 | Buyer | After stating budget “my budget is 1.2Cr”, then ask “what’s my budget?” | AI recalls budget from memory | | |
| 6 | Buyer | “When is my visit?” | Deterministic reply with correct datetime | | |
| 7 | Staff (sales_agent) | “Visits today” | Returns list of visits | | |
| 8 | Staff | “Update lead [phone] status to visited” | Status updated; action log created | | |
| 9 | Staff | With `AGENT_AI_LLM_ENABLED=false` env, same as #8 | Deterministic CRM still works | | |
| 10 | Admin | Open `/dashboard/ai-action-logs` | See recent actions (at least one) | | |
| 11 | System (inject) | Simulate send confirmation failure in workflow | Visit marked `needs_reconciliation`; admin notified | | |
| 12 | Buyer | Dashboard takeover, then buyer messages | Documented behavior (per product decision) | | |

**A+ gate:** All 12 rows have ✅ in “Prod handset result” column.

---

## 6. Success Criteria – A+ Grade Definition

| Principle | A+ Requirement | Proof |
|-----------|----------------|-------|
| **Unified memory** | Single `lead_memory` JSON; no repeat questions across 5 turns | Handset #5 passes |
| **Idempotent mutations** | Duplicate book/reschedule/cancel requests produce same outcome | Handset #3 passes |
| **Atomic saga** | Any step failure rolls back or flags `needs_reconciliation` | Handset #11 passes |
| **Clarification logged** | Every low‑confidence mutation triggers `workflow_clarification` log | Action log query shows entries |
| **Fast‑path short‑circuit** | “When is my visit?” never calls LLM | No OpenAI call in logs for that message |
| **Staff copilot all roles** | `viewer` gets read‑only WhatsApp AI (not “use dashboard”) | Test with viewer role |
| **Dashboard parity** | Staff can chat with AI in browser (same as WhatsApp) | `/dashboard/copilot` works |
| **Handset matrix** | All 12 scenarios pass on real phone against prod | Table above all ✅ |
| **Automated tests** | 100% pass rate in CI | GitHub Actions green |

---

## 7. Phased Work Plan (from current B → A+)

| Phase | Focus | Estimated time | Exit criteria |
|-------|-------|----------------|----------------|
| **A** | **Audit & infrastructure** | 1 week | Gap report complete; smoke scripts target Railway; mail SMTP fixed |
| **B** | **Memory unification** | 2 weeks | `lead_memory` single source; RAG synced; handset #5 passes |
| **C** | **Saga + idempotency** | 2 weeks | Compensators for all mutation workflows; handset #3, #11 pass |
| **D** | **Intent + telemetry** | 1 week | Clarification logging; expanded scenario matrix; handset #4, #8 pass |
| **E** | **Staff hardening** | 1 week | Viewer role copilot; LLM‑off degradation; handset #7, #9 pass |
| **F** | **Dashboard copilot** | 2 weeks | `POST /api/copilot/chat` + frontend chat UI; handset #10 updated |
| **G** | **Final A+ validation** | 1 week | All 12 handset scenarios pass; full test suite green; grade A+ |

**Total:** 10 weeks if full‑time, 20 weeks if part‑time.

---

## 8. Continuous Re‑evaluation (How to Loop)

After each weekly iteration:

1. **Run the full test matrix** (automated + handset).
2. **Update the gap report** – mark closed gaps.
3. **Re‑grade** using the scorecard in section 7 of the master reality doc.
4. **If grade < A+** → continue loop.
5. **If grade ≥ A+** → celebrate, then set up **quarterly regression** (rerun handset matrix and automated tests to prevent decay).

**Important:** The loop never ends – even after A+, you must run the handset matrix every month and after every significant code change.

---

## 9. Immediate First Steps (Monday Morning)

- [ ] Run the **automated audit scripts** (section 3.1) and save output as `docs/audit-YYYY-MM-DD.md`.
- [ ] Complete the **manual audit checklist** (section 3.2).
- [ ] Produce **gap report** with priorities.
- [ ] Fix **mail SMTP** on Railway (P0).
- [ ] Repoint `verify-workflow-scenarios-production.ps1` to Railway URL (P0).
- [ ] Run the **handset matrix** for the first time – document current failures (baseline).
- [ ] Start **Phase A** – audit & infrastructure.

---

## 10. Conclusion

> **Investo will achieve the fullest, most extreme, A+ agentic WhatsApp experience not by guessing, but by auditing every line of code, comparing it to the ideal architecture, and looping through fixes – with every loop validated by exhaustive automated and real‑handset tests.**

This document is the **master implementation plan**. It supersedes all previous ad‑hoc plans. Update it after every loop with new gap status and grades.

**Now go execute.**