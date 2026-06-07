# Investo AI & Agentic WhatsApp — Master Reality, Proof, and A+ Plan

> **Purpose:** Single source of truth. No sugarcoating. Current state with evidence, what is **not** proven, and a looping implementation plan until buyer + staff WhatsApp AI reaches **A+**.  
> **Audience:** Engineering, product, ops, client demos.  
> **Last updated:** 2026-06-06  
> **Supersedes for planning:** Consolidates `ai-reality-check-and-roadmap.md`, `ai-implementation-plan.md`, and `docs/PRODUCTION_SCENARIO_PROOF.md` into one actionable doc. Keep those files as deep references; **this file is the grade + loop authority.**

---

## 0. Executive verdict (read this first)

| Question | Honest answer |
|----------|----------------|
| Is AI working in production? | **Yes** — buyer and staff WhatsApp pipelines are wired and deployed. |
| Is it “perfect” or A+? | **No.** Current composite grade: **B** (buyer WhatsApp), **B+** (staff WhatsApp copilot), **D** (dashboard agentic parity). |
| Is agentic AI “fullest / extreme / top level”? | **No.** Multi-step workflows + LangGraph exist, but memory unity, saga hardening, live handset proof, clarification telemetry, and dashboard copilot are incomplete. |
| Can you demo core flows safely? | **Yes** — brochure, price, visit book/reschedule, staff CRM phrases, with known edge-case risk on borderline visit mutations. |
| What blocks A+? | See [§5 Gap ledger](#5-gap-ledger-blocking-a) and [§8 A+ implementation loop](#8-a-implementation-loop-build--prove--fix--repeat). |

**Production URLs (authoritative for biginvesto.online):**

| Layer | URL | Notes |
|-------|-----|-------|
| Frontend | https://biginvesto.online | Vercel prod |
| Backend API | https://investo-backend-production.up.railway.app/api | Railway prod (frontend `api.ts` points here) |
| Legacy backend | https://investo-backend-v2.onrender.com/api | Still live; **not** wired to frontend; webhook docs may still reference it |

---

## 1. What Investo AI actually is (not one bot)

Six surfaces share databases; only **two** are conversational agentic WhatsApp:

| # | Surface | Users | Agentic? | Grade |
|---|---------|-------|----------|-------|
| 1 | **Buyer WhatsApp AI** | Prospects (unknown phones) | Workflows + policy/LLM dual brain | **B** |
| 2 | **Staff WhatsApp Copilot** | `sales_agent`, `company_admin`, `operations`, `super_admin` | Deterministic → workflows → intents → LangGraph | **B+** |
| 3 | **Dashboard** | Browser users | **No AI chat**; config + CRM + AI Action Logs viewer | **D** (agentic) |
| 4 | Proactive automation | System cron/queue | Templates, not LLM agent | **A** (reliability) |
| 5 | Property import AI | Admins | Vision/text extraction | Out of WhatsApp scope |
| 6 | LangGraph staff agent | Fallback in copilot | Tool-calling LLM | **B** (fallback tier) |

**Identity routing** (`inboundWhatsAppRouting.service.ts`):

```
Unknown phone → buyer pipeline (whatsapp.service.ts)
Copilot roles   → agent-router.service.ts
viewer / other  → static “use dashboard” (NO AI)
```

---

## 2. Pipeline maps (proof of wiring)

### 2.1 Buyer WhatsApp order

```
Meta / GreenAPI webhook → 200 immediately
  → handleIncomingMessage()
  → claimInboundMessageFull (DB + Redis dedup)
  → routeCompanyScopedInbound → customer
  → interactive buttons (if ai_active)
  → ensureProspectConversationAiActive()
  → tryCommitCustomerVisitBooking()          [deterministic fast-path]
  → visitCommit.workflowSuggestion → runWorkflow OR classifyAndRunBuyerWorkflow()
  → detectActiveVisitMutationBias()          [P4 — before LLM]
  → deterministic visit-status query
  → aiService.generateResponse()             [policy + LLM + RAG]
  → extractAndPatchLeadMemory()              [P1 — fire-and-forget]
  → contextual quick replies / media
```

**Key files:** `whatsapp.service.ts`, `workflow-engine.service.ts`, `ai.service.ts`, `buyer-memory-extract.service.ts`, `customerVisitBooking.service.ts`

**Buyer workflows (8):** `brochure_request`, `price_inquiry`, `availability_check`, `amenities_question`, `escalate_to_human`, `schedule_visit`, `reschedule_visit`, `cancel_visit` — `workflow.constants.ts`

### 2.2 Staff WhatsApp copilot order

```
routeCompanyScopedInbound → copilot role
  → handleAgentMessage() in agent-router.service.ts
  → pending confirmations (YES/NO)
  → tryDeterministicAgentCrmReply()
  → classifyAndRunWorkflow()        [15 workflows]
  → classifyAndExecuteAgentIntent()   [~50 intents]
  → invokeAgent() + clientMemory RAG  [LangGraph]
  → fallback help menu
```

**Key files:** `agent-router.service.ts`, `agent-intent-orchestrator.service.ts`, `agent-graph.service.ts`, `agent-crm-query.service.ts`

### 2.3 Capability map (code-declared)

`backend/src/constants/ai-capabilities.constants.ts` — exported on `GET /api/health` under `ai_capabilities` (verified on Render health payload 2026-06-06).

---

## 3. Grade scorecard — today vs A+ target

### 3.1 Principle grades (`ai.md` alignment)

| Principle | Today | A+ requires | Blocker |
|-----------|-------|-------------|---------|
| Stateful / remembers visits | **A** | **A+** | Nightly summary → `lead_memory`; zero repeat questions in prod handset tests |
| Idempotent / no duplicate replies | **A-** | **A+** | Prod proof: duplicate book same slot → one visit row |
| Transactional workflow rollback | **B-** | **A+** | Simulated step failure → compensate or `needs_reconciliation` + alert in dashboard |
| Proactive reminders | **A** | **A+** | Monitor delivery failures; mail SMTP currently **down** on Render health |
| Contextual intent (“push visit”) | **B+** | **A+** | 100% clarification or correct mutation on handset matrix |
| Covers intent variations | **B-** | **A+** | Expand scenario matrix + live phrase bank |
| Transparent (what AI did) | **C+** | **A+** | Action logs + per-lead memory panel + clarification events logged |
| Staff dashboard copilot | **C** (shipped, parity-pending) | **A** (optional for WhatsApp A+) | `POST /api/copilot/chat` → `handleAgentMessage` shipped; needs quick-actions, history, kill-switch/rate-limit parity |
| Unified memory (1 truth) | **C+** | **A+** | `lead_memory` sole source; RAG derived; buyer patch → `syncLeadClientMemory` |
| Takeover semantics | **C** | **A** | Product decision + sticky takeover or documented always-on |

### 3.2 Channel grades

| Channel | Grade | One-line reality |
|---------|-------|------------------|
| Buyer WhatsApp | **B** | Strong happy paths; memory write-back shipped but **not prod-validated on real handset**; edge mutations still risky |
| Staff WhatsApp | **B+** | Best-in-codebase surface; LangGraph is fallback; viewer role excluded |
| Dashboard AI | **C** | Action logs yes; browser copilot **shipped** (`/dashboard/copilot` → `POST /api/copilot/chat`), parity-pending |
| **Composite WhatsApp agentic** | **B** | Not A+. Not “fullest ever.” Solid foundation, incomplete hardening + proof. |

---

## 4. Proof & validation matrix

Legend: ✅ proven | ⚠️ partial | ❌ not proven | 🔁 must re-run each loop

### 4.1 Automated tests (local CI)

| Proof | Command / file | Last known result | Limits |
|-------|----------------|-------------------|--------|
| Full backend unit suite | `cd backend && npm test` | **678/678 PASS** (113 suites, 2026-06-06 session) | Mocks LLM; not live OpenAI |
| Workflow scenario matrix | `npm test -- workflow-scenario-matrix` | **49/49 PASS** | 15 workflows × phrases; mocked classifier |
| Buyer memory P1 | `buyer-memory-extract.service.test.ts` | **5 tests PASS** | Deterministic extract only; no LLM extract |
| Action log API P3 | `agent-action-log.routes.test.ts` | PASS (admin 200, sales_agent 403) | No UI e2e |
| Active-visit bias P4 | `workflow-engine.service.test.ts` | PASS (`detectActiveVisitMutationBias`, buyer workflow bias) | No prod handset |
| Intent orchestrator | `agent-intent-orchestrator.service.test.ts` | PASS | Staff path |
| Webhook reliability | `webhook.routes.reliability`, `deduplication` | PASS | Simulated payloads |
| Frontend unit | `cd frontend && npm test` | **75/75 PASS** (21 files) | Component-level |
| Frontend build + route | `npm run build` | PASS — `/dashboard/ai-action-logs` | No Playwright |
| E2E Playwright | `npm run test:e2e` | **SKIPPED** | `E2E_EMAIL` / `E2E_PASSWORD` not set |

🔁 **Loop rule:** Re-run full backend + frontend test suites after every AI change. Gate = 0 failures.

### 4.2 Production smoke (live HTTP)

Verified **2026-06-06 UTC** against Railway (`investo-backend-production.up.railway.app`):

| Check | Result | Evidence |
|-------|--------|----------|
| `GET /api/health/live` | ✅ `{"status":"ok"}` | curl 2026-06-06 |
| `GET /api/agent-action-logs` (no auth) | ✅ **401** | Route exists (was 404 pre-deploy) |
| Deployed commit / upload | ✅ Session deploy live | Upload deploy `fe15ea6d` SUCCESS 2026-06-06 |
| `GET /api/health` full (Railway) | ✅ ok; **mail SES ok** | `dependencies.mail.status: ok` |
| OpenAI on prod | ✅ configured | Railway health `openai.status: ok` |
| Webhook `POST /api/webhook` buyer/staff phrases | ✅ **200 on Railway** | `verify-workflow-scenarios-production.ps1` @ Railway URL |

❌ **Not prod-proven:**

| # | Scenario | Why it matters |
|---|----------|----------------|
| 1 | Buyer brochure → `leads.lead_memory.projectsDiscussed` in **production DB** | P1 unit tests only |
| 2 | Buyer visit book → `lead_memory.upcomingVisits` in **production DB** | Same |
| 3 | “Push my appointment” with active visit on **real buyer handset** | P4 unit only |
| 4 | Duplicate “book Saturday 4pm” → **one visit row** on prod | Idempotency unit mocked |
| 5 | Workflow fails after `bookVisit` → compensate or `needs_reconciliation` visible in dashboard | No integration test executed on prod |
| 6 | Staff copilot from **registered sales_agent phone** on live tenant | Webhook simulation only; admin JWT script failed 401 |
| 7 | Clarification events in `agent_action_logs` | ✅ Shipped in code; prod DB proof pending handset |
| 8 | `syncLeadClientMemory` after buyer `patchLeadMemory` | ✅ Shipped; prod vector proof pending |

### 4.3 Code-path proof (shipped vs stub)

| Feature | Status | File evidence |
|---------|--------|---------------|
| P1 buyer memory write-back | ✅ Shipped | `whatsapp.service.ts` → `extractAndPatchLeadMemory` (3 hooks) |
| P1 LLM memory extract | ❌ Not shipped | `BUYER_MEMORY_LLM_EXTRACT` mentioned only in comment |
| P1 RAG sync after buyer patch | ✅ Shipped | `buyer-memory-extract.service.ts` → `syncLeadClientMemory` |
| P3 action log API | ✅ Shipped | `agent-action-log.routes.ts` |
| P3 action log UI | ✅ Shipped | `AIActionLogsPage.tsx`, nav `ai_action_logs` |
| P4 active-visit bias | ✅ Shipped | `detectActiveVisitMutationBias` in `workflow-engine.service.ts` |
| P4 clarification logging | ✅ Shipped | `workflow_clarification` in `workflow-engine.service.ts` |
| P2 saga compensators | ⚠️ Partial | Unit test for post-mutation failure → compensate; handset #11 open |
| P2 idempotency prod proof | ⚠️ Partial | `claimWorkflowExecution` wired; duplicate-book prod test missing |
| Dashboard copilot | ✅ Shipped | `copilot.routes.ts` + `/dashboard/copilot` UI |
| Viewer read-only copilot | ✅ Shipped | `viewer` in `AGENT_COPILOT_ROLES`; mutation guard in `agent-router.service.ts` |
| Per-lead memory panel | ✅ Shipped | `LeadDetailPage.tsx` "What AI Knows" panel |
| Sticky takeover | ❌ Not decided | `ensureProspectConversationAiActive` still always-on |

---

## 5. Gap ledger (blocking A+)

| ID | Gap | Impact | Priority | Exit proof |
|----|-----|--------|----------|------------|
| G1 | **8 memory stores not unified** | AI repeats questions; staff/buyer prompts diverge | P0 | Handset: “what’s my budget?” after stating budget → no re-ask |
| G2 | **Buyer patch without `syncLeadClientMemory`** | RAG stale vs `lead_memory` | P0 | After brochure, vector search returns same project |
| G3 | **Saga not A+** | Partial visit + no confirmation | P0 | Inject send failure → compensated or flagged in UI |
| G4 | **Idempotency not prod-proven** | Double booking same slot | P0 | Two messages → one `visits` row |
| G5 | **Clarification not logged** | Cannot debug misroutes | P1 | `agent_action_logs.action = workflow_clarification` |
| G6 | **No live handset matrix** | Demo risk | P0 | 10-scenario WhatsApp script on prod tenant |
| G7 | **E2E Playwright skipped** | UI regressions | P1 | Green e2e in CI |
| G8 | **Prod smoke targets Render** | False confidence | P1 | `verify-workflow-scenarios-production.ps1` → Railway URL |
| G9 | **Mail SMTP down** | Confirmation/reminder delivery risk | P1 | `health.dependencies.mail.status: ok` |
| G10 | **Dashboard copilot missing** | Staff expect browser agent | P2 | `POST /api/copilot/chat` parity with WhatsApp |
| G11 | **Takeover semantics undefined** | Human vs AI confusion | P2 | Product sign-off + tests |
| G12 | **viewer role no AI** | Staff segment excluded | P3 | Document or extend roles |
| G13 | **No nightly `conversationSummary` in lead_memory** | Weak long-thread continuity | P2 | Cron + spot check |
| G14 | **Per-lead “what AI knows” UI** | Support blind | P1 | Lead detail panel reads `lead_memory` |

---

## 6. What “A+ WhatsApp agentic” means (target definition)

Non-negotiable bar for **A+** on buyer + staff WhatsApp:

1. **Memory:** Every turn patches `lead_memory`; RAG index synced within 60s; zero repeat questions on 10-scenario handset script.
2. **Mutations:** Visit book/reschedule/cancel never double-writes; confidence 0.65–0.75 → clarification **with log**; active visit biases reschedule/cancel.
3. **Saga:** No orphan visits without confirmation or `needs_reconciliation` + admin notification within 5 minutes.
4. **Idempotency:** Same intent + params within 24h → cached reply, one DB row.
5. **Transparency:** Every autonomous action in `agent_action_logs`; admin filters by lead; clarification events visible.
6. **Staff copilot:** Deterministic + workflow + intent + LangGraph degradation **proven** with LLM on and off on prod.
7. **Reliability:** Webhook 200-first, dedup, no 5xx on scenario matrix payloads against **Railway** prod.
8. **Loop:** Documented recheck cycle (below) run after every sprint; grades updated in this file.

**A+ does not require** dashboard browser copilot for WhatsApp grade — but composite product grade stays **B+** until dashboard copilot ships.

---

## 7. Acceptance test matrix (handset + prod)

Run on **production Railway** tenant with real phones. Mark each run date in this table.

| # | Actor | Message / action | Pass criteria | Auto test | Prod handset |
|---|-------|------------------|---------------|-----------|--------------|
| 1 | Buyer | “Send brochure for [project]” | Brochure sent; `lead_memory.projectsDiscussed` updated | ✅ unit | ❌ |
| 2 | Buyer | “Book visit Saturday 4pm” | One visit; confirmation; `upcomingVisits` | ✅ unit | ❌ |
| 3 | Buyer | Repeat #2 (new message_id) | Idempotent reply; **one** visit row | ⚠️ unit mock | ❌ |
| 4 | Buyer | Active visit + “push to Sunday” | Reschedule or clarification; no duplicate | ✅ unit | ❌ |
| 5 | Buyer | “What’s my budget?” after stating budget | Uses memory; no re-ask | ❌ | ❌ |
| 6 | Buyer | “When is my visit?” | Deterministic DB reply | ✅ unit | ❌ |
| 7 | Staff | “Visits today” | Deterministic list | ✅ unit | ⚠️ webhook 200 only |
| 8 | Staff | “Update lead X status to visited” | Workflow or CRM; action log | ✅ matrix | ❌ |
| 9 | Staff | LLM off (`AGENT_AI_LLM_ENABLED=false`) | Deterministic CRM still works | ⚠️ config | ❌ |
| 10 | Admin | Open `/dashboard/ai-action-logs` | See recent actions | ✅ API unit | ❌ UI handset |
| 11 | System | Inject confirmation send failure | Compensate or reconcile visible | ❌ | ❌ |
| 12 | Buyer | Dashboard takeover then inbound | Documented behavior per P6 | ❌ | ❌ |

**A+ gate:** **12/12 prod handset PASS** + automated suite green.

---

## 8. A+ implementation loop (build → prove → fix → repeat)

Do **not** ship a phase and stop. Each iteration:

```
┌─────────────┐
│ 1. BUILD    │ Implement smallest slice from §9 backlog
└──────┬──────┘
       ▼
┌─────────────┐
│ 2. UNIT     │ npm test (backend 663+, frontend 75+); add tests for new behavior
└──────┬──────┘
       ▼
┌─────────────┐
│ 3. INTEGRATE│ workflow-scenario-matrix + new integration tests
└──────┬──────┘
       ▼
┌─────────────┐
│ 4. DEPLOY   │ Railway: git push + GraphQL redeploy OR deploy-railway-upload.ps1
└──────┬──────┘
       ▼
┌─────────────┐
│ 5. SMOKE    │ curl health; /api/agent-action-logs 401; webhook script on Railway URL
└──────┬──────┘
       ▼
┌─────────────┐
│ 6. HANDSET  │ Run §7 matrix on real WhatsApp; query prod DB for lead_memory
└──────┬──────┘
       ▼
┌─────────────┐
│ 7. GRADE    │ Update §3 scorecard in this file; if any criterion < A, goto 1
└─────────────┘
```

**Cadence:** Weekly loop minimum until composite WhatsApp grade ≥ **A**.

**Artifacts per loop:**

- Test output pasted or linked in PR
- Handset results table (§7) dated
- `agent_action_logs` screenshot for mutation/clarification rows
- This file §3 grades updated

---

## 9. Phased backlog to A+ (ordered)

### Phase A — Proof infrastructure (Week 1)

**Goal:** Stop flying blind. Grade ceiling: **B+**.

| Task | Owner | Done when |
|------|-------|-----------|
| A1 | Point `verify-workflow-scenarios-production.ps1` at Railway URL | Script default = `investo-backend-production.up.railway.app` |
| A2 | Add `scripts/verify-ai-handset-matrix.ps1` | Documents 12 scenarios + DB queries for `lead_memory` |
| A3 | Configure E2E secrets in CI | Playwright green for login + `/dashboard/ai-action-logs` |
| A4 | Prod admin credentials for staff webhook tests | Staff phrase webhook resolves real agent phone |
| A5 | Fix mail SMTP on prod | `GET /api/health` → `mail.status: ok` |

**Exit:** Railway webhook script all PASS; E2E not skipped.

---

### Phase B — Memory A+ (Week 2)

**Goal:** Single truth. Grade target: buyer **B+**.

| Task | File(s) | Done when |
|------|---------|-----------|
| B1 | After `patchLeadMemory`, call `syncLeadClientMemory(leadId)` | `buyer-memory-extract.service.ts` |
| B2 | Optional `BUYER_MEMORY_LLM_EXTRACT=true` micro-extract | Feature flag + unit tests |
| B3 | Staff path: ensure `patchLeadMemory` on copilot exchanges | `agent-router.service.ts` / `recordAgentCopilotExchange` audit |
| B4 | Deprecate redundant prompt-only context | Parity tests: prompt block === `lead_memory` |
| B5 | Per-lead memory panel (read-only JSON) | Lead detail UI component |
| B6 | Handset scenarios #1, #2, #5 | §7 marked ✅ |

**Exit:** Handset #1 #2 #5 PASS; G1 G2 closed.

---

### Phase C — Saga & idempotency A+ (Week 3)

**Goal:** No silent partial state. Grade target: **A-**.

| Task | File(s) | Done when |
|------|---------|-----------|
| C1 | Integration test: fail `sendVisitConfirmation` → compensate | `workflow-engine.service.test.ts` or dedicated integration |
| C2 | `needs_reconciliation` → notification + action log | `workflow-compensator.service.ts`, `notification.engine.ts` |
| C3 | Prod duplicate-book test (handset #3) | One visit row |
| C4 | `workflow_compensation` entries in action log UI | Admin sees compensation rows |
| C5 | Hourly reconciliation alert smoke | Cron fires; test record visible |

**Exit:** Handset #3 #11 PASS; G3 G4 closed.

---

### Phase D — Intent & telemetry A+ (Week 4)

**Goal:** Borderline phrases handled visibly. Grade target: **A**.

| Task | File(s) | Done when |
|------|---------|-----------|
| D1 | Log `workflow_clarification` to `agent_action_logs` | `workflow-engine.service.ts` |
| D2 | Log misclassification `{ confidence, alternatives }` | Same + action log filters |
| D3 | Expand scenario matrix with 20+ borderline phrases | New rows in `workflow-scenario-matrix.test.ts` |
| D4 | Handset #4 #8 with action log verification | §7 ✅ |
| D5 | `resolvePendingClarification` buyer channel tests | Unit coverage |

**Exit:** Handset #4 #8 PASS; G5 G6 closed; clarification visible in dashboard.

---

### Phase E — Staff hardening (Week 5)

**Goal:** Staff copilot **A**.

| Task | Done when |
|------|-----------|
| E1 | Prod staff handset: visits today, status update, reschedule | §7 rows 7–8 ✅ |
| E2 | LLM-off degradation test on prod | Row 9 ✅ |
| E3 | LangGraph failure → CRM fallback logged | action log `invokeAgent_failed` or equivalent |
| E4 | Expand `agent_availability` for buyer (optional) | Workflow in `BUYER_WORKFLOW_IDS` if product wants |

**Exit:** Staff channel grade **A** in §3.

---

### Phase F — Product parity (Week 6+)

**Goal:** Composite product **A+** (optional for WhatsApp-only A+).

| Task | Done when |
|------|-----------|
| F1 | `POST /api/copilot/chat` reusing `handleAgentMessage` core | API + rate limit |
| F2 | Dashboard chat UI (admin/sales) | Sidebar copilot |
| F3 | P6 takeover decision implemented | §7 row 12 defined + tested |
| F4 | Nightly `conversationSummary` → `lead_memory` | Cron + spot check |

---

## 10. Re-check commands (copy-paste every loop)

```powershell
# ── Automated gate ──
cd backend
npm test
npm test -- workflow-scenario-matrix
npm test -- buyer-memory-extract agent-action-log workflow-engine
npm run build

cd ..\frontend
npm test
npm run build

# ── Production smoke (Railway) ──
curl.exe -s https://investo-backend-production.up.railway.app/api/health/live
curl.exe -s -o NUL -w "agent-action-logs: %{http_code}`n" https://investo-backend-production.up.railway.app/api/agent-action-logs

# ── Webhook scenarios (update script to Railway first) ──
.\scripts\verify-workflow-scenarios-production.ps1

# ── Deploy paths ──
# Git: .\scripts\deploy-railway-backend.ps1  (account token → GraphQL redeploy)
# Local: .\scripts\deploy-railway-upload.ps1   (mint project token → railway up from repo root)

# ── DB proof (prod) — after handset tests ──
# SELECT lead_memory FROM leads WHERE phone = '<buyer_phone>' ORDER BY updated_at DESC LIMIT 1;
# SELECT * FROM agent_action_logs WHERE company_id = '<id>' ORDER BY created_at DESC LIMIT 20;
# SELECT COUNT(*) FROM visits WHERE lead_id = '<id>' AND scheduled_at = '<slot>';
```

---

## 11. Kill switches & ops (know before demo)

| Env var | Effect |
|---------|--------|
| `AGENT_AI_ENABLED=false` | Master off staff stack |
| `AGENT_AI_COPILOT_ENABLED=false` | Staff → “use dashboard” |
| `AGENT_AI_LLM_ENABLED=false` | Staff deterministic only |
| `AGENT_AI_CRON_ENABLED=false` | No proactive staff cron |

Buyer AI: **no master kill** — runs when WhatsApp connected and sender is prospect.

---

## 12. Honest demo script (what to claim today)

**Safe to claim:**

- “Buyer WhatsApp AI handles property questions, brochures, visit booking/reschedule/cancel, and escalation through a layered pipeline with workflows and LLM.”
- “Staff copilot on WhatsApp runs CRM commands, multi-step workflows, and intent tools with LangGraph fallback.”
- “We have 663 automated backend tests and a 49-case workflow phrase matrix.”
- “Admins can inspect AI actions at `/dashboard/ai-action-logs`.”

**Do not claim until §7 handset matrix is green:**

- “AI never double-books.”
- “AI always remembers everything from prior turns.”
- “Every partial failure is automatically rolled back.”
- “Fullest / extreme / A+ agentic experience.”
- “Staff have AI in the dashboard browser.”

---

## 13. Document maintenance

| Event | Action |
|-------|--------|
| Each sprint merge | Update §3 grades and §4 proof table |
| Each prod deploy | Record deploy ID + commit in §4.2 |
| Each handset run | Fill §7 date column |
| A+ achieved | Set composite grade **A+** here; archive loop to quarterly regression |

**Related deep dives (not duplicated here):**

- Ideal behavior: [`ai.md`](./ai.md)
- Historical gap tracker: [`ai-implementation-plan.md`](./ai-implementation-plan.md)
- Architecture narrative: [`ai-reality-check-and-roadmap.md`](./ai-reality-check-and-roadmap.md)
- Legacy prod proof: [`../../docs/PRODUCTION_SCENARIO_PROOF.md`](../../docs/PRODUCTION_SCENARIO_PROOF.md) — **migrate checks to Railway**

---

## 14. Current snapshot (2026-06-06)

| Item | Value |
|------|-------|
| Git HEAD | `6ac6c2ab3` — P1/P3/P4 AI ship |
| Railway active deploy | `7c8a1fad` (upload) / `09de35fd` (git @ same commit) |
| Backend tests | 663/663 PASS (last full run) |
| Workflow matrix | 49/49 PASS |
| Composite WhatsApp grade | **B** |
| A+ achieved? | **No** — implementation loop §8 active |

*Next loop action: Phase A (Railway webhook script + handset matrix + E2E secrets).*
