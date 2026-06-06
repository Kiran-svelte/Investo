# Global proof: LLM intent + workflow engine (production + scenario matrix)

**Production API:** `https://investo-backend-v2.onrender.com`  
**Last verified:** 2026-06-06 (UTC)

This document is the global (not local-only) proof for:

1. **LLM-powered intent recognition** — intent classifier, parameter extraction, action handlers  
2. **Multi-step autonomous workflow** — workflow engine, actions, workflows, LLM integration  

---

## 1. Architecture (deployed on production)

### Staff WhatsApp copilot routing order

```
Pending confirmations
  → tryDeterministicAgentCrmReply (deterministic, no LLM)
  → classifyAndRunWorkflow (LLM workflow classifier + step runner)
  → classifyAndExecuteAgentIntent (LLM intent + execute)
  → invokeAgent (LangGraph) with deterministic fallback on error
```

### Buyer WhatsApp routing order

```
tryCommitCustomerVisitBooking / visit mutations (deterministic)
  → tryRunBuyerWorkflow (workflow engine)
  → AI / brochure / conversion engines
```

### Code map

| Layer | Path |
|--------|------|
| Intent constants (~50 intents) | `backend/src/constants/agent-intent.constants.ts` |
| Intent orchestrator | `backend/src/services/agent/agent-intent-orchestrator.service.ts` |
| Lead resolution | `backend/src/services/agent/agent-lead-resolution.service.ts` |
| Deterministic CRM fast paths | `backend/src/services/agent/agent-crm-query.service.ts` |
| Router | `backend/src/services/agent/agent-router.service.ts` |
| Workflow registry (15 workflows) | `backend/src/services/workflow/workflow-registry.ts` |
| Workflow engine | `backend/src/services/workflow/workflow-engine.service.ts` |
| Action handlers (45+) | `backend/src/services/workflow/actions/index.ts` |

---

## 2. Production infrastructure proof

Run: `.\scripts\verify-workflow-scenarios-production.ps1`

| Check | Result | Notes |
|--------|--------|--------|
| `GET /api/health` | **PASS** | `status=ok`, DB ok |
| OpenAI dependency | **PASS** | API key valid, embeddings reachable |
| Admin login | **FAIL (401)** | Default script credentials not valid on prod; webhooks still provable without JWT |
| Staff webhook `visits today` | **PASS** | HTTP 200 — copilot path does not crash |
| Buyer webhook `price_inquiry` | **PASS** | HTTP 200 |
| Buyer webhook `brochure` | **PASS** | HTTP 200 |
| Buyer webhook `prepone` | **PASS** | HTTP 200 — prepone/reschedule path alive |

Webhook proofs exercise the **same** inbound pipeline as live WhatsApp (`POST /api/webhook`), on the Render service that serves production traffic.

---

## 3. Scenario matrix (all 15 workflows × phrasing variants)

**Test file:** `backend/src/tests/unit/workflow-scenario-matrix.test.ts`  
**Command:** `cd backend && npm test -- workflow-scenario-matrix`  
**Result:** **49/49 passed**

For each workflow, the matrix proves:

- **Classification:** mocked LLM returns the canonical `workflow` id; engine accepts confidence ≥ 0.55 (no per-phrase regex tree).
- **Execution:** `runWorkflow` runs all registered steps for that workflow id with shared mocks.

### Workflows and example phrases

| Workflow | Example phrases covered |
|----------|-------------------------|
| `new_lead` | new lead from WhatsApp; create lead Rahul 9876543210 |
| `update_status` | mark as hot; change to contacted; **Update lead kannada media status to visited**; set status to visited for kannada media |
| `add_note` | Note: wants corner plot; Remember: price sensitive |
| `assign_agent` | Assign to Rajesh; change agent to Priya |
| `schedule_visit` | Visit Saturday 4pm; Book site visit tomorrow 1pm |
| `reschedule_visit` | Postpone to Sunday; **Pre pone site visit to tomorrow at 1pm** |
| `cancel_visit` | Cancel visit; I can't make it to the site visit |
| `complete_visit` | Visit done; Saw the property today |
| `mark_visit_outcome` | Liked it; Not interested; Will decide later |
| `price_inquiry` | What's the price?; How much for 3BHK? |
| `availability_check` | Is 3BHK available?; Any units left? |
| `brochure_request` | Send brochure; Share PDF details |
| `amenities_question` | What amenities?; Is there a pool? |
| `agent_availability` | Is Rajesh free?; Which agent is available? |
| `escalate_to_human` | Talk to agent; Call me please |

---

## 4. Intent orchestrator + deterministic CRM (unit proofs)

| Suite | Focus | Command |
|--------|--------|---------|
| `agent-intent-orchestrator.service.test.ts` | classify → extract → execute pipeline | `npm test -- agent-intent` |
| `agent-crm-query.service.test.ts` | Kannada status update, visit lookup, new leads today guards | `npm test -- agent-crm` |
| `visitIntentFromMessage.service.test.ts` | Prepone / postpone / cancel detection | `npm test -- visitIntent` |
| `visitMutationFromChat.service.test.ts` | Reschedule mutation with new datetime | `npm test -- visitMutation` |
| `workflow-engine.service.test.ts` | Kannada update via workflow; reschedule guard | `npm test -- workflow-engine` |
| `agent-router.workflow.test.ts` | Router calls workflow after deterministic returns null | `npm test -- agent-router.workflow` |

**Full bundle:**  
`npm test -- --testPathPattern="workflow-scenario-matrix|workflow-engine|agent-intent|agent-crm|visitIntent|visitMutation|agent-router.workflow"`

---

## 5. Screenshot / production bug scenarios (expected behavior)

| User message | Expected path | Proof |
|--------------|---------------|--------|
| Update lead kannada media status to visited | Deterministic or `update_status` workflow → DB status | `agent-crm-query` + `workflow-engine` + matrix row |
| New leads today (must not steal status updates) | Deterministic guard `wantsNewLeadsToday` | `agent-crm-query.service.test.ts` |
| Pre pone site visit to tomorrow at 1pm | Buyer visit mutation / `reschedule_visit` | `visitIntent` + matrix + prod webhook prepone |
| When is visit booked / visits today | Deterministic visit schedule lookup | `agent-crm-query` |
| Generic "I hit an issue…" | `invokeAgent` try/catch + CRM fallback | `agent-router` + prod staff webhook 200 |

---

## 6. What “global” vs “local” means here

| Global | Local |
|--------|--------|
| Render health + OpenAI on prod URL | Jest mocks for LLM responses |
| Real `POST /api/webhook` on prod (200, no 5xx) | No Meta/Green API delivery in CI |
| Same router code path as live WhatsApp | Admin JWT proof needs valid prod credentials |

For **end-to-end WhatsApp text on a real staff handset**, send the phrases above from a registered `sales_agent` phone on the Geeky tenant; webhook proofs confirm the server accepts and processes those payloads without crashing.

---

## 7. Re-run checklist

```powershell
# Production smoke
.\scripts\verify-workflow-scenarios-production.ps1

# Full scenario + intent matrix (local)
cd backend
npm test -- --testPathPattern="workflow-scenario-matrix|workflow-engine|agent-intent|agent-crm|visitIntent|visitMutation|agent-router.workflow"
```

Optional: set `-Email` / `-Password` on the production script when prod admin credentials are known, to resolve a real staff agent phone for staff webhook tests.

---

## 8. P1 / P3 / P4 acceptance proof (2026-06-06)

**Scope:** Buyer memory write-back (P1), dashboard AI Action Log (P3), active-visit bias + mutation guardrails (P4).  
**Environment:** Local workspace `D:\projects\Investo` — automated tests + production builds.

### Automated test results

| Acceptance criterion | Test / command | Result |
|---------------------|----------------|--------|
| Brochure → `projectsDiscussed` | `buyer-memory-extract.service.test.ts` — `extracts projectsDiscussed from brochure outbound text` | **PASS** |
| Visit book → `upcomingVisits` | `buyer-memory-extract.service.test.ts` — `extracts upcomingVisits from visit commit snapshot` | **PASS** |
| Memory merge (no overwrite) | `buyer-memory-extract.service.test.ts` — `extractAndPatchLeadMemory merges projects` | **PASS** |
| `GET /api/agent-action-logs` admin RBAC | `agent-action-log.routes.test.ts` — company_admin 200, sales_agent 403 | **PASS** |
| Active visit → reschedule bias | `workflow-engine.service.test.ts` — `detectActiveVisitMutationBias maps push appointment` | **PASS** |
| "Push my appointment" skips LLM | `workflow-engine.service.test.ts` — `classifyAndRunBuyerWorkflow biases reschedule when active visit exists` | **PASS** |
| No workflow regression | `workflow-scenario-matrix.test.ts` | **49/49 PASS** |
| Copilot prompt intact | `system-prompt.test.ts` | **PASS** |
| Backend compile | `cd backend && npm run build` | **PASS** |
| Frontend compile + route | `cd frontend && npm run build` (includes `/dashboard/ai-action-logs`) | **PASS** |
| Frontend nav RBAC | `navigation.config.test.ts` — `ai_action_logs` visible to `company_admin` | **PASS** |

### Commands to reproduce

```powershell
cd backend
npm test -- buyer-memory-extract.service.test.ts agent-action-log.routes.test.ts workflow-engine.service.test.ts system-prompt.test.ts
npm test -- workflow-scenario-matrix
npm run build

cd ..\frontend
npm test -- navigation.config.test.ts
npm run build
```

### Code-path proof (wired in production code)

| Path | File | Hook |
|------|------|------|
| After buyer workflow reply | `backend/src/services/whatsapp.service.ts` | `extractAndPatchLeadMemory` (fire-and-forget) |
| After visit commit | `backend/src/services/whatsapp.service.ts` | `extractAndPatchLeadMemory` + `visitCommit` snapshot |
| After AI `generateResponse` | `backend/src/services/whatsapp.service.ts` | `extractAndPatchLeadMemory` + `aiExtractedInfo` |
| Active-visit pre-rules | `backend/src/services/workflow/workflow-engine.service.ts` | `detectActiveVisitMutationBias` before LLM |
| Dashboard API | `backend/src/routes/agent-action-log.routes.ts` | `GET /api/agent-action-logs` |
| Dashboard UI | `frontend/src/pages/ai-action-logs/AIActionLogsPage.tsx` | Route `/dashboard/ai-action-logs` |

### Manual prod checks (post-deploy)

1. Send buyer brochure on WhatsApp → query `leads.lead_memory->'projectsDiscussed'` for that lead.
2. Book buyer visit → confirm `lead_memory.upcomingVisits` contains `visitId`.
3. Login as `company_admin` → open `/dashboard/ai-action-logs` → filter by status/date.
4. With active visit, send "push my appointment" → expect reschedule/clarification reply (no second visit row).

---

## 9. Full QA matrix (2026-06-06) — all automated gates PASS

| Category | What ran | Result |
|----------|----------|--------|
| **Unit tests** | Backend Jest 110 suites | **663/663 PASS** |
| **Unit tests** | Frontend Vitest 21 files | **75/75 PASS** |
| **Regression** | `workflow-scenario-matrix` (15 workflows × phrases) | **49/49 PASS** |
| **AI — intent** | `workflow-engine`, `agent-intent-orchestrator`, `agent-router.workflow` | PASS |
| **AI — memory** | `buyer-memory-extract`, `clientMemory`, `ai-agent-6pillar` | PASS |
| **AI — prompt** | `system-prompt`, `realEstateAssistantPrompt`, `ai.service.fallback` | PASS |
| **AI — confidence** | `workflow-engine` mutation thresholds + active-visit bias | PASS |
| **Contract / RBAC** | `agent-action-log.routes`, `lead-property-route-contract`, `route-dto-mappers` | PASS |
| **Webhook / idempotency** | `webhook.routes.reliability`, `deduplication`, `greenapi-webhook` | PASS |
| **Security** | `webhook.routes.security`, `sanitize`, `rate-limiter`, `rbac`, `lead-gdpr` | PASS |
| **Reliability** | `circuit-breaker`, `retry.util`, `workflow-compensator` (via engine tests) | PASS |
| **Performance smoke** | `load-health.perf.test.ts` | PASS |
| **Health / infra** | `health.routes`, `production-polish.health`, `npm run build` (both) | PASS |
| **Component tests** | `App.guards`, `ConversationsPage`, `PropertiesPage`, `navigation.config` | PASS |
| **Business rules** | `neverSayNoResponseGuard`, `automation-post-visit`, `visitMutationFromChat` | PASS |
| **E2E (Playwright)** | Skipped — `E2E_EMAIL` / `E2E_PASSWORD` not set in CI shell | N/A |

### Deploy status (same session)

| Target | Method | Status |
|--------|--------|--------|
| **Frontend** | `npx vercel deploy --prod` | **LIVE** — https://biginvesto.online (deployment `dpl_5ULEpbjaXfcMkjXjTuTV3vzHshQ1`) |
| **Backend (Railway)** | GraphQL + `railway up` with provided token | **BLOCKED** — token returns `Not Authorized` / `Project Token not found` |
| **Backend (Render prod)** | `GET /api/health` smoke | **LIVE** — https://investo-backend-v2.onrender.com (pre-push code; new AI routes need backend redeploy) |

**To complete backend deploy:** generate a fresh Railway **account** token at https://railway.app/account/tokens (`No Team` scope), or provide `RENDER_API_KEY` for `scripts/redeploy-production.ps1`, then re-run deploy.
