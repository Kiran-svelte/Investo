# Investo AI Alignment Audit & Fix Plan

<!-- SESSION STATUS (2026-06-06):
  ORCHESTRATOR EXTRACTION COMPLETE (see backend/docs/walkthrough.md):
  - H1–H9 in whatsappTurnOrchestrator.service.ts; whatsapp.service.ts delegates AI branch to sendTurnResult
  - sendPropertyMediaForStage / sendPropertyTypeFilters DELETED
  - resolveBrochureForAiTurn + resolveHeroMediaComponent + enforceTurnComponentBudget wired
  - Interactive shortlist capped to 1 hero via sendTurnResult
  PHASE 0–3 COMPLETE: mutation guard, takeover, confidence gate, visit state, idempotency, sanitizer, button policies, attendance buttons, GreenAPI runtime removed.
  EVAL: npm run eval → 5/5 PASS (buyerRouting, responseSafety, buttonPolicy, outboundBudget, staffCopilot).
  REMAINING: more-info interactive multi-send; BuyerTurnDeps DI; handset scenario runner 12/12.
  VERIFICATION: tsc --noEmit = 0 errors; orchestrator+eval tests 49/49 pass.
-->


**Purpose:** Single document listing every PASS / PARTIAL / FAIL from the deep codebase audit (2026-06-06), plus a concrete implementation plan to move each PARTIAL and FAIL to PASS.

**Companion docs:** `fix.md` (target architecture), `AI_OPERATIONS_BIBLE.md` (ops + routing), `AI_MASTER_REALITY_AND_A_PLUS_PLAN.md`

**Overall grade:** ~70–75% aligned with the target product model.

**One-line verdict:** Investo **is** a bounded business assistant (NL in → classify → workflow/tool → reply), but **is not yet** the clean A+ spec (one orchestrator, one outbound, strict safety guarantees, persistent takeover).

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Master Scorecard](#2-master-scorecard)
3. [PASS — No Action Required](#3-pass--no-action-required)
4. [PARTIAL — Gaps & Fix Plans](#4-partial--gaps--fix-plans)
5. [FAIL — Missing & Fix Plans](#5-fail--missing--fix-plans)
6. [Implementation Phases](#6-implementation-phases)
7. [Verification Checklist](#7-verification-checklist)
8. [File Index](#8-file-index)

---

## 1. Executive Summary

### What the target model says

| Actor | Input | Engine | Output |
|-------|-------|--------|--------|
| **Buyer** | Natural WhatsApp text | Fast-paths → workflows → LLM fallback | One clean reply + buttons only at decisions |
| **Staff** | Natural WhatsApp / dashboard text | Confirm → workflow → tools → LangGraph | Short ops reply + contextual next actions |

**Golden rules:**
- Never say "booked", "updated", "completed" unless backend succeeded.
- No internal IDs, match scores, workflow names in buyer text.
- Buttons only at greeting, confirm, shortlist, post-action, attendance.
- Human takeover stops AI until released.
- Visit state machine enforced everywhere.

### What Investo does today

```
Inbound Meta webhook
  → dedup (PASS)
  → staff routing OR buyer cascade (PASS)
  → tryCommitCustomerVisitBooking (PARTIAL)
  → fast paths: rapport / memory / qualify / visit status (PARTIAL)
  → classifyAndRunBuyerWorkflow (PARTIAL — confidence bypass)
  → aiService.generateResponse (PARTIAL — false booking risk)
  → polish / guards / buttons / media / brochure (PARTIAL — multi-send)
```

Staff path via `agent-router.service.ts` is stronger (PASS on pipeline + shortcuts) but has gaps on visit transitions, audit logs, and attendance UX.

---

## 2. Master Scorecard

| # | Area | Status | Priority |
|---|------|--------|----------|
| 1 | Natural language → workflow/tool → reply (buyer) | **PASS** | — |
| 2 | Fast-paths before LLM | **PASS** | — |
| 3 | Mutation confidence thresholds | **PASS** | — |
| 4 | No internal IDs/scores/workflow names (buyer) | **PASS** | — |
| 5 | No false "booked/updated" language | **PASS** | — |
| 6 | Buttons only at decision points | **PASS** | — |
| 7 | One outbound per inbound | **PARTIAL** | P2 |
| 8 | No duplicate handlers per turn | **PASS** | — |
| 9 | Meta WhatsApp only (runtime) | **PASS** | — |
| 10 | GreenAPI fully removed (repo) | **PASS** | — |
| 11 | Single `whatsappTurnOrchestrator` | **PASS** | — |
| 12 | `metaMessageBuilder` service | **PASS** | — |
| 13 | `metaInboundParser` service | **PASS** | — |
| 14 | Unified `whatsappResponseSanitizer` | **PASS** | — |
| 15 | `buyerButtonPolicy` / `copilotButtonPolicy` services | **PASS** | — |
| 16 | `WhatsAppComponent` type | **PASS** | — |
| 17 | Buyer vs staff separation | **PASS** | — |
| 18 | Staff copilot pipeline (workflow → tools → LangGraph) | **PASS** | — |
| 19 | Staff shortcut anti-spam | **PASS** | — |
| 20 | Destructive staff action confirmation | **PASS** | — |
| 21 | Visit state machine enforcement | **PASS** | — |
| 22 | Attendance: ask before no-show | **PASS** | — |
| 23 | Attendance: interactive buttons | **PASS** | — |
| 24 | Human takeover (WhatsApp) | **PASS** | — |
| 25 | 15 canonical workflows | **PASS** | — |
| 26 | `agent_action_logs` transparency | **PASS** | — |
| 27 | Visit booking idempotency (all paths) | **PASS** | — |
| 28 | Meta interactive buttons/lists wired | **PASS** | — |

**Priority key:** P0 = safety/correctness blocker · P1 = core product gap · P2 = UX/polish · P3 = hygiene

---

## 3. PASS — No Action Required

These areas match the target. Keep them; do not regress during refactors.

### 3.1 Buyer vs staff separation — PASS

- **Evidence:** `inboundWhatsAppRouting.service.ts` routes staff to `agent-router.service.ts`, buyers stay in `whatsapp.service.ts`.
- **Behavior:** Different tools, permissions (viewer read-only), and button policies.

### 3.2 Staff copilot pipeline — PASS

- **Evidence:** `agent-router.service.ts` order: greeting → pending confirm → deterministic CRM → `classifyAndRunWorkflow` → intent orchestrator → LangGraph.
- **Dashboard:** `copilot.routes.ts` reuses `handleAgentMessage` — same brain as WhatsApp staff.

### 3.3 Staff shortcut anti-spam — PASS

- **Evidence:** `copilotShortcut.util.ts` — welcome/help only; blocks buttons after action results and confirmation prompts.
- **Tests:** `copilotShortcut.util.test.ts`.

### 3.4 Fifteen canonical workflows — PASS

- **Evidence:** `workflow.constants.ts` (`WORKFLOW_IDS`) + `workflow-registry.ts` (`WORKFLOW_DEFINITIONS`) — all 15 with step chains and `INTENT_TO_WORKFLOW` mapping.
- **Tests:** `workflow.constants.test.ts`, `workflow-catalog.util.test.ts`.

### 3.5 Meta WhatsApp runtime — PASS

- **Evidence:** `config/index.ts` — `type WhatsAppProvider = 'meta'`; throws if not meta.
- **Evidence:** `providers/index.ts` exports only `MetaWhatsAppProvider`.
- **Evidence:** `app.ts` mounts `/api/webhook` for Meta only.

### 3.6 Buyer workflow reply sanitization — PASS (workflow path)

- **Evidence:** `formatBuyerWorkflowReply`, `buildBuyerWorkflowFailureReply`, `stripBuyerInternalWorkflowLines` in `workflow-engine.service.ts`.
- **Strips:** IDs, match scores, workflow errors, staff-only lines, "grounded" catalog labels.

### 3.7 Attendance cron does not auto-mark no-show — PASS (core)

- **Evidence:** `cron-scheduler.service.ts` — creates `attendance_check` pending actions; sends agent prompt; only marks no-show after agent replies NO via `confirmation.service.ts`.

### 3.8 Meta interactive buttons/lists wired — PASS

- **Evidence:** `whatsapp.service.ts` — `sendInteractiveButtons`, `sendInteractiveList`, `sendCompanyInteractiveButtons`.
- **Evidence:** `webhook.routes.ts` — `extractCustomerMessage` parses `button_reply` / `list_reply`.
- **Tests:** `interactive-buttons.test.ts`, `webhook.routes.reliability.test.ts`.

### 3.9 Inbound dedup — PASS

- **Evidence:** `claimInboundMessageFull`, `claimCustomerInboundFingerprint`, `claimCustomerProcessingTurn` in `whatsapp.service.ts` + `inboundMessageGuard.service.ts`.

---

## 4. PARTIAL — Gaps & Fix Plans

---

### 4.1 Natural language → workflow/tool → single clean outbound — PARTIAL → PASS

**Current state:**
- Cascade exists but is spread across 5+ files, not one orchestrator.
- Buyer turn is priority-ordered branches, not a linear pipeline.
- `ai.service.ts` duplicates some fast-path logic if messages reach the language brain.

**Gap:**
- No single `TurnResult` contract.
- Multiple code paths can handle the same intent class.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Define `WhatsAppAudience`, `TurnResult`, `WhatsAppComponent` types | `backend/src/types/whatsapp-turn.types.ts` (new) |
| 2 | Create `whatsappTurnOrchestrator.service.ts` with `handleBuyerTurn()` and `handleStaffTurn()` | new |
| 3 | Move buyer cascade from `whatsapp.service.ts` `handleIncomingMessage` into orchestrator as ordered steps returning `TurnResult \| null` (fallthrough) | orchestrator + slim `whatsapp.service.ts` |
| 4 | Remove duplicate fast-path checks from `ai.service.ts` — orchestrator must never pass already-handled intents to LLM | `ai.service.ts` |
| 5 | Orchestrator returns exactly one `TurnResult`; `whatsapp.service.ts` only sends what orchestrator returns | `whatsapp.service.ts` |
| 6 | Add unit tests: one intent → one handler wins; no double execution | `whatsapp-turn-orchestrator.test.ts` (new) |

**Acceptance criteria:**
- [ ] Every buyer inbound goes through `handleBuyerTurn()` only.
- [ ] `TurnResult` is the single contract for text + components + actionResult.
- [ ] No fast-path logic remains in `ai.service.ts` for buyer channel.
- [ ] First match wins; later branches never run.

**Effort:** 3–5 days · **Priority:** P1

---

### 4.2 Fast-paths before LLM — PARTIAL → PASS

**Current state:**
- Visit commit, rapport, memory, qualification, visit-status fast paths run before workflow/LLM in `whatsapp.service.ts`.
- `isBuyerRapportMessage` matches bare "hi" and always sends welcome, ignoring returning-client history.
- Cancel/reschedule can still reach post-LLM `applyVisitMutationFromChat`.

**Gap:**
- Returning buyer saying "Hi" gets reset welcome.
- Visit mutations have three layers (commit, workflow, post-LLM) instead of one.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Update `isBuyerRapportMessage` to require **no prior outbound messages** OR explicit session reset | `buyerQualification.service.ts` |
| 2 | Pass `conversation.messageCount` or `lead_memory.lastInteraction` into rapport check | `whatsapp.service.ts` / orchestrator |
| 3 | For returning clients, `buildBuyerRapportReply` → short ack ("Welcome back! Still looking at Lake Vista, or something new?") not full welcome | `customerMessageFastPath.service.ts` |
| 4 | Consolidate visit mutations: commit path OR workflow path only — remove post-LLM `applyVisitMutationFromChat` for buyer channel | `whatsapp.service.ts`, `visitMutationFromChat.service.ts` |
| 5 | If workflow misses a visit mutation, return clarification prompt instead of LLM improvisation | orchestrator |

**Acceptance criteria:**
- [x] Returning buyer "Hi" does not replay full welcome buttons.
- [x] New stranger "Hi" still gets Buy / Rent / Book visit.
- [x] Visit cancel/reschedule never runs in post-LLM mutation layer for buyers.
- [ ] Scenario runner #1 (greeting) and #10 (memory) pass.

**Effort:** 1–2 days · **Priority:** P2

---

### 4.3 Mutation confidence thresholds — PARTIAL → PASS

**Current state:**
- Thresholds defined: query ≥0.65, mutation execute ≥0.80, clarify band 0.70–0.80 in `workflow.constants.ts`.
- `evaluateMutationConfidence()` used in main classifier path.
- **Bypassed by:** `detectBuyerNegotiationEscalationBias`, `detectActiveVisitMutationBias`, `tryRunBuyerWorkflow` regex fallback, pending-clarification resume.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Create `evaluateMutationGate(workflowId, confidence, source)` — single gate used everywhere | `workflow-engine.service.ts` |
| 2 | Bias detectors return `{ workflowId, confidence, params }` and pass through gate — no direct `runWorkflow` | `workflow-engine.service.ts` |
| 3 | Regex fallback (`tryRunBuyerWorkflow`) must supply confidence=1.0 for exact pattern matches only; ambiguous regex → clarify, not execute | `workflow-engine.service.ts` |
| 4 | Pending-clarification resume: re-evaluate confidence on resumed params before execute | `workflow-engine.service.ts` |
| 5 | Log `workflow_clarification` when gate returns `clarify` | `workflow-engine.service.ts` |
| 6 | Unit tests: bias path with confidence 0.75 → clarification, not booking | `workflow-confidence.test.ts` (new) |

**Acceptance criteria:**
- [ ] No buyer mutation executes below `MUTATION_CONFIDENCE_THRESHOLD` (0.80) unless source is `exact_regex` with documented patterns.
- [ ] All mutation entry points call `evaluateMutationGate`.
- [ ] Clarification logged in `agent_action_logs`.

**Effort:** 1–2 days · **Priority:** P1

---

### 4.4 No internal IDs/scores/workflow names in buyer replies — PARTIAL → PASS

**Current state:**
- Workflow path sanitizes well.
- Leaks possible via: idempotency message ("workflow is already being processed"), saga partial failure ("*Schedule Visit* partially completed"), LLM path (no UUID/score stripper), property-tools generating `ID:` / `Match score:` before strip.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Create `whatsappResponseSanitizer.service.ts` with `sanitizeBuyerOutbound(text, channel)` | new |
| 2 | Rules: strip UUIDs, `ID:`, `Match score:`, `Workflow`, `grounded`, `propertyId`, handler names | sanitizer |
| 3 | Replace idempotency buyer message: "I'm already working on that visit request. One moment." | `workflow-engine.service.ts` |
| 4 | Replace saga partial failure buyer text: human-safe "Your visit time is saved; we'll confirm details shortly." | `workflow-compensator.service.ts` |
| 5 | Run **every** buyer outbound (workflow fast-path, LLM, fallback) through sanitizer before send | orchestrator / `whatsapp.service.ts` |
| 6 | Stop generating internal metadata in buyer-facing tool formatters — use buyer format at source | `property-tools.ts`, `format-helpers.ts` |
| 7 | Tests: inject dirty strings → assert clean output | `whatsapp-response-sanitizer.test.ts` (new) |

**Acceptance criteria:**
- [x] No buyer message contains UUID regex, "workflow", "Match score", "ID:", or "grounded".
- [x] All outbound paths call sanitizer (grep audit).
- [ ] Scenario runner output audit passes.

**Effort:** 1–2 days · **Priority:** P2

---

### 4.5 No false "booked/updated/completed" language — PARTIAL → PASS

**Current state:**
- Workflow and visit-commit paths only claim success after DB success. **PASS on those paths.**
- LLM fallback (`aiService.generateResponse`) can freely generate booking language with no backend commit.
- Saga partial failure says "was saved" ambiguously.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Create `mutationLanguageGuard.service.ts` with `guardBookingClaims(text, turnContext)` | new |
| 2 | `turnContext` includes: `visitCommitted`, `workflowSuccess`, `workflowId`, `actionStatus` | orchestrator |
| 3 | If text matches booking/update patterns (`booked`, `scheduled`, `confirmed`, `updated`, `cancelled`) AND no successful mutation this turn → replace with: "I can help book that — which project and time works for you?" or re-prompt confirm | guard |
| 4 | Apply guard after LLM generation, before polish/send | `whatsapp.service.ts` / orchestrator |
| 5 | Add system prompt rule: "Never claim a visit is booked unless tool result confirms success" | `realEstateAssistantPrompt.constants.ts` |
| 6 | Fix saga partial failure text (see 4.4) | `workflow-compensator.service.ts` |
| 7 | Test: send "book lake vista tomorrow 4pm" with workflow disabled + commit miss → outbound must NOT contain "booked" | new test |

**Acceptance criteria:**
- [ ] Zero buyer messages claim booking/update without `actionResult.status === 'success'` this turn.
- [ ] Guard runs on every LLM-generated buyer reply.
- [ ] Handset scenario: vague booking without confirm → clarification, not false success.

**Effort:** 1 day · **Priority:** P0

---

### 4.6 Buttons only at decision points — PARTIAL → PASS

**Current state:**
- `contextQuickReplies.util.ts` has good gating (blocks on confirm prompts, recentAction, human_escalated).
- Same inbound can still send: text + property media + filter buttons + contextual buttons + brochure PDF.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Create `buyerButtonPolicy.service.ts` — `resolveBuyerComponents(turnContext): WhatsAppComponent[]` | new |
| 2 | Encode rules from `fix.md` §6: greeting, confirm, shortlist (≤3 buttons), list (4+), post-action next steps only | buyerButtonPolicy |
| 3 | Max **one** interactive message per turn (buttons OR list, not both) | buyerButtonPolicy |
| 4 | Property media: attach to main message context or send as reply-to thread — not separate interactive | `whatsapp.service.ts` |
| 5 | Brochure PDF: only after `brochure_request` workflow success; counts as media attachment, not extra button row | `brochureDelivery.service.ts` |
| 6 | `recentAction` blocks all buttons for 1 turn (already partial) — extend to block filter buttons too | `contextQuickReplies.util.ts` |
| 7 | Migrate logic from `contextQuickReplies.util.ts` + `customerQuickReplies.util.ts` into policy service | refactor |

**Acceptance criteria:**
- [x] Max 1 interactive payload per inbound turn.
- [x] No buttons on factual Q&A replies.
- [x] Post-booking shows only: Get location / Reschedule / Talk to agent.
- [x] Property filters only during qualify stage, not after every property mention.

**Effort:** 2–3 days · **Priority:** P2

---

### 4.7 No duplicate handlers per turn — PARTIAL → PASS

**Current state:**
- Inbound dedup is strong.
- Visit cancel/reschedule attempted in commit, workflow, and post-LLM layers.
- `ai.service.ts` mirrors fast-path logic.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Orchestrator returns `handled: true` after first successful branch — no fallthrough | orchestrator |
| 2 | Remove post-LLM `applyVisitMutationFromChat` for buyers (see 4.2) | `whatsapp.service.ts` |
| 3 | Guard: if `visitCommit.committed`, skip `classifyAndRunBuyerWorkflow` for schedule (already exists — verify and test) | `whatsapp.service.ts` |
| 4 | Remove buyer fast-path duplication from `ai.service.ts` | `ai.service.ts` |
| 5 | Add integration test: "cancel my visit" triggers exactly one of commit/workflow, never both + LLM | new test |

**Acceptance criteria:**
- [ ] Each inbound triggers at most one mutation handler.
- [ ] `workflow_run_records` shows ≤1 workflow per inbound messageId.
- [ ] No duplicate visit rows on double-send.

**Effort:** 1–2 days (bundled with orchestrator) · **Priority:** P2

---

### 4.8 GreenAPI repo hygiene — PASS

**Current state:**
- Runtime is Meta-only. `backend/src` has no GreenAPI provider/routes; only intentional config rejection tests reference `greenapi`.
- Dead `!== 'meta'` fallback branches removed from `whatsapp.service.ts`.
- Compiled `backend/dist/*greenapi*` artifacts removed.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Delete `greenapi-whatsapp.provider.ts` if still on disk | providers/ |
| 2 | Delete `greenapi-webhook.routes.ts` | routes/ |
| 3 | Delete GreenAPI unit tests | tests/unit/ |
| 4 | Remove dead `!== 'meta'` fallback branch in `sendInteractiveButtons` | `whatsapp.service.ts` |
| 5 | Update `ai-settings.routes.whatsapp-test.test.ts`, `scripts/test-ai-reply.ts` | tests, scripts |
| 6 | Grep repo for `greenapi` / `GreenAPI` — update or remove docs (`runbook.md`, `ai-reality-check-and-roadmap.md`) | docs |
| 7 | CI grep gate: fail build if `greenapi` appears in `backend/src` | optional script |

**Acceptance criteria:**
- [x] No GreenAPI provider/routes in `backend/src` (only intentional config rejection tests).
- [x] `WHATSAPP_PROVIDER` only accepts `meta`.
- [x] All tests pass without GreenAPI mocks.

**Effort:** 0.5 day · **Priority:** P3

---

### 4.9 `metaInboundParser` — PARTIAL → PASS

**Current state:**
- `extractCustomerMessage()` lives inline in `webhook.routes.ts`.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Create `metaInboundParser.service.ts` — move `extractCustomerMessage` + media/location parsing | new |
| 2 | Export types: `MetaInboundMessage`, `ParsedCustomerTurn` | types |
| 3 | `webhook.routes.ts` calls parser only | `webhook.routes.ts` |
| 4 | Move existing tests to parser test file | tests |

**Acceptance criteria:**
- [x] Webhook route has no parsing logic >10 lines.
- [x] Button/list reply IDs extracted consistently.

**Effort:** 0.5 day · **Priority:** P2

---

### 4.10 Unified response sanitizer — PARTIAL → PASS

**Current state:**
- Sanitization split across: `messagePolish.service.ts`, `aiTransparency.service.ts`, `workflow-engine.service.ts`, `neverSayNoResponseGuard.service.ts`, `groundingGuard.service.ts`.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Create `whatsappResponseSanitizer.service.ts` — pipeline: neverSayNo → grounding → internal strip → polish → length | new |
| 2 | `sanitizeBuyerOutbound(text, opts)` calls full pipeline | sanitizer |
| 3 | `sanitizeStaffOutbound(text, opts)` — lighter strip (keep CRM terms) | sanitizer |
| 4 | Orchestrator calls one function before send | orchestrator |
| 5 | Deprecate direct calls to individual guards in `whatsapp.service.ts` — route through sanitizer | refactor |
| 6 | Keep individual services as internal steps (don't delete logic) | existing files |

**Acceptance criteria:**
- [x] One import for all buyer outbound sanitization.
- [x] Order documented and tested: neverSayNo before grounding before strip.

**Effort:** 1 day · **Priority:** P2

---

### 4.11 Button policy services — PARTIAL → PASS

**Current state:**
- Logic in `contextQuickReplies.util.ts`, `customerQuickReplies.util.ts`, `copilotShortcut.util.ts`.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Create `buyerButtonPolicy.service.ts` (see 4.6) | new |
| 2 | Create `copilotButtonPolicy.service.ts` — wrap `resolveStaffCopilotQuickActions` + `shouldSendCopilotShortcutMenu` | new |
| 3 | Utils become thin wrappers or deleted after migration | utils |
| 4 | `agent-router.service.ts` imports copilotButtonPolicy only | `agent-router.service.ts` |

**Acceptance criteria:**
- [x] No button decision logic in `whatsapp.service.ts` directly.
- [x] Policy services have dedicated unit tests.

**Effort:** 1 day (bundled with 4.6) · **Priority:** P3

---

### 4.12 Human takeover (WhatsApp + CRM) — PASS

**Current state:**
- CRM APIs: `PATCH /conversations/:id/takeover` → `agent_active`; `release` → `ai_active`.
- `ensureProspectConversationAiActive` skips when `aiEnabled === false` or `status === 'agent_active'`.
- Frontend `ConversationsPage.tsx`: takeover banner, AI status badge, Release to AI button.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Takeover API must set `{ status: 'agent_active', aiEnabled: false }` | `conversation.routes.ts` |
| 2 | Release API must set `{ status: 'ai_active', aiEnabled: true }` | `conversation.routes.ts` |
| 3 | `ensureProspectConversationAiActive`: skip if `aiEnabled === false` OR `status === 'agent_active'` | `whatsapp.service.ts` |
| 4 | Buyer inbound when `!aiEnabled`: send static handoff text only; no AI, no buttons, no workflow | `whatsapp.service.ts` / orchestrator |
| 5 | Staff sends message → auto takeover (keep existing) | `conversation.routes.ts` |
| 6 | Escalate workflow sets same flags as manual takeover | `escalate-actions.ts` |
| 7 | **Update test** `whatsapp.inbound-processing.test.ts` — expect AI stays off after takeover until release | tests |
| 8 | Frontend: show takeover banner + release button in ConversationsPage | `ConversationsPage.tsx` | ✅ |

**Acceptance criteria:**
- [x] After takeover, buyer message gets handoff text, not AI reply.
- [x] After release, AI resumes with memory intact.
- [x] `aiEnabled: false` persists across inbound messages until release.
- [x] CRM shows "Human takeover active" banner + Release to AI when `agent_active` or `ai_enabled: false`.

**Effort:** 1–2 days · **Priority:** P0

---

### 4.13 Destructive staff action confirmation — PARTIAL → PASS

**Current state:**
- Cancel visit: confirmed via `createPendingConfirmation`. **PASS.**
- Reassign: confirmed on reassignment. **PASS.**
- Complete visit: no confirmation. **GAP.**
- Mark no-show via free text: no dedicated tool. **GAP.**
- Workflow `assign_agent` may continue after confirm prompt without `stop: true`. **GAP.**

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Add `markVisitNoShow` tool with mandatory confirm: "Should I mark {lead}'s visit as no-show?" | `visit-tools.ts` |
| 2 | Wire intent `mark_no_show` → tool or `mark_visit_outcome` workflow with confirm step | `agent-intent.constants.ts`, orchestrator |
| 3 | `completeVisit` tool: add confirm when status transition is irreversible | `visit-tools.ts` |
| 4 | `reassignLead` action in workflow: return `{ stop: true }` after confirmation prompt | `lead-actions.ts` |
| 5 | Staff free text "didn't visit" / "no show" → always confirm before mutate | `agent-router.service.ts` / confirmation |
| 6 | Tests: "mark amogh no show" → confirm prompt → yes → mutation | new test |

**Acceptance criteria:**
- [ ] No visit status mutation to `no_show` / `completed` / `cancelled` without confirm or attendance cron flow.
- [ ] Workflow assign stops after confirmation prompt.

**Effort:** 1–2 days · **Priority:** P1

---

### 4.14 Visit state machine enforcement — PARTIAL → PASS

**Current state:**
- `VISIT_TRANSITIONS` in `validation.ts`. REST API enforces.
- `visitState.service.ts`, `markVisitAttended`, `markVisitNoShow`, `rescheduleVisitById` bypass transitions.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Export `isValidVisitTransition(from, to)` from `validation.ts` | `validation.ts` |
| 2 | All status updates in `visitState.service.ts` call `isValidVisitTransition` — throw or return error if invalid | `visitState.service.ts` |
| 3 | `markVisitAttended`: only from `confirmed` (or add explicit `scheduled → confirmed` step first) | `visitState.service.ts` |
| 4 | `markVisitNoShow`: only from `confirmed` | `visitState.service.ts` |
| 5 | `rescheduleVisitById`: preserve status if `confirmed`; only reset to `scheduled` if was `scheduled` | `visitState.service.ts` |
| 6 | Copilot tools delegate to `visitState.service.ts` only — no direct `prisma.visit.update` for status | `visit-tools.ts`, `visit-actions.ts` |
| 7 | Unit tests for every valid/invalid transition | `visit-state-machine.test.ts` (new) |

**Acceptance criteria:**
- [ ] `scheduled → completed` rejected (must go through `confirmed`).
- [ ] `scheduled → no_show` rejected (must go through `confirmed` or attendance flow).
- [ ] REST and copilot use same transition table.

**Effort:** 1–2 days · **Priority:** P1

---

### 4.15 Attendance flow (text → buttons) — PARTIAL → PASS

**Current state:**
- Cron asks before no-show. **PASS.**
- Uses plain text "Reply YES / NO" via `sendNotification`, not Meta interactive buttons.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Create `attendanceWorkflow.service.ts` — `sendAttendanceCheck(visit, agent)` | new |
| 2 | Message body per `fix.md` §5: "Attendance check required / Visit: … / Scheduled: … / Did the customer attend?" | service |
| 3 | Buttons: `Yes, attended` · `No, no-show` · `Reschedule` via `sendCompanyInteractiveButtons` | service |
| 4 | Map button IDs to `attendanceCheckYes` / `handleAttendanceCheckRejected` / reschedule flow | `confirmation.service.ts`, `handleInteractiveAction` |
| 5 | Replace `sendNotification` text in `cron-scheduler.service.ts` with attendanceWorkflow | `cron-scheduler.service.ts` |
| 6 | Keep text YES/NO as fallback if interactive send fails | attendanceWorkflow |
| 7 | Test: cron fires → agent gets buttons → Yes → visit `completed`, lead `visited` | integration test |

**Acceptance criteria:**
- [x] Attendance check sends interactive buttons on Meta.
- [x] Yes → `completed` + lead `visited`.
- [x] No → `no_show` + lead NOT `visited`.
- [x] Reschedule → time picker or confirm flow.
- [x] No auto no-show before button tap.

**Effort:** 1–2 days · **Priority:** P2

---

### 4.16 `agent_action_logs` transparency — PARTIAL → PASS

**Current state:**
- LangGraph tool calls logged. Cron logged. Buyer workflow runs logged.
- Staff successful workflow runs often NOT logged.
- Pending confirmation resolution not in action logs.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | After every successful `runWorkflow` for staff channel, call `logAgentAction({ action: 'workflow_${id}', status: 'success', ... })` | `workflow-engine.service.ts` |
| 2 | Log failures too with `status: 'failed'` and reason | same |
| 3 | Log confirmation resolution: `attendance_check_yes`, `cancel_visit_confirmed`, etc. | `confirmation.service.ts` |
| 4 | Log buyer workflow runs (keep existing) — verify not regressed | same |
| 5 | Dashboard AI Action Logs page shows workflow + tool + confirmation events | `AIActionLogsPage.tsx` |
| 6 | Test: staff schedules visit via workflow → row appears in `agent_action_logs` | new test |

**Acceptance criteria:**
- [x] Every staff mutation has an `agent_action_logs` row.
- [x] Every buyer mutation has an `agent_action_logs` row.
- [x] Attendance resolution logged with visitId + outcome.

**Effort:** 1 day · **Priority:** P2

---

### 4.17 Visit booking idempotency (all paths) — PARTIAL → PASS

**Current state:**
- Workflow path: `claimWorkflowExecution` + Redis + `workflow_idempotency_keys` table. **PASS.**
- LangGraph / direct `scheduleVisit` tool bypasses workflow dedup.
- `visitBooking.service.scheduleVisit` has conflict detection but no message-level dedup key.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Add `buildVisitIdempotencyKey(companyId, leadId, scheduledAtISO)` to shared util | `workflow-engine.service.ts` or new util |
| 2 | `scheduleVisit` in `visitBooking.service.ts`: check key in Redis + DB before create | `visitBooking.service.ts` |
| 3 | `visit-tools.ts` `scheduleVisit` tool: pass idempotency key from message context | `visit-tools.ts` |
| 4 | `tryCommitCustomerVisitBooking`: use same key shape as workflow | `customerVisitBooking.service.ts` |
| 5 | Return existing visit on duplicate key instead of creating second row | `visitBooking.service.ts` |
| 6 | Test: same "book tomorrow 4pm" twice within 60s → 1 visit row | integration test |

**Acceptance criteria:**
- [ ] All schedule paths (workflow, commit, tool, LangGraph) share idempotency key format.
- [ ] Duplicate inbound → ≤1 new visit row.
- [ ] Buyer sees "already booked for that time" not error.

**Effort:** 1–2 days · **Priority:** P1

---

## 5. FAIL — Missing & Fix Plans

---

### 5.1 Single `whatsappTurnOrchestrator` — FAIL → PASS

**Current state:** Logic scattered across `whatsapp.service.ts` (~4500 lines), `workflow-engine.service.ts`, `ai.service.ts`, utils.

**Implementation plan:** See **§4.1** (primary refactor). This is the umbrella FAIL that unlocks several PARTIAL fixes.

**New files:**
```
backend/src/services/whatsapp/whatsappTurnOrchestrator.service.ts
backend/src/services/whatsapp/metaMessageBuilder.service.ts
backend/src/services/whatsapp/metaInboundParser.service.ts
backend/src/services/whatsapp/whatsappResponseSanitizer.service.ts
backend/src/services/buyer/buyerButtonPolicy.service.ts
backend/src/services/copilot/copilotButtonPolicy.service.ts
backend/src/services/copilot/copilotTurnOrchestrator.service.ts  (staff wrapper)
backend/src/types/whatsapp-turn.types.ts
```

**`whatsappTurnOrchestrator` skeleton:**
```ts
export async function handleWhatsAppTurn(ctx: InboundTurnContext): Promise<TurnResult> {
  const audience = await resolveAudience(ctx);
  if (audience === 'staff') return handleStaffTurn(ctx);
  return handleBuyerTurn(ctx);
}

async function handleBuyerTurn(ctx): Promise<TurnResult> {
  if (ctx.humanTakeover) return handoffResult(ctx);
  if (ctx.interactivePayload) return handleInteractive(ctx);
  const visitCommit = await tryCommitCustomerVisitBooking(ctx);
  if (visitCommit.committed) return successResult(visitCommit);
  for (const fastPath of BUYER_FAST_PATHS) {
    const r = await fastPath(ctx);
    if (r) return r;
  }
  const workflow = await classifyAndRunBuyerWorkflow(ctx);
  if (workflow) return workflow;
  const llm = await aiService.generateResponse(ctx);
  return guardAndSanitize(llm, ctx);
}
```

**`whatsapp.service.ts` after refactor:** webhook ingress, send helpers, provider resolution only — target <1500 lines.

**Acceptance criteria:**
- [ ] `handleIncomingMessage` delegates to orchestrator in <50 lines.
- [ ] All buyer branches testable in isolation.
- [ ] TypeScript build passes.

**Effort:** 3–5 days · **Priority:** P1

---

### 5.2 `metaMessageBuilder` — FAIL → PASS

**Current state:** Interactive payloads built inline in `sendInteractiveButtons`, `sendInteractiveList`, `sendFlowMessage`.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Create `metaMessageBuilder.service.ts` | new |
| 2 | `buildTextMessage(body)` → Meta payload | builder |
| 3 | `buildButtonMessage(body, buttons: WhatsAppButton[])` → interactive button payload | builder |
| 4 | `buildListMessage(body, sections)` → interactive list payload | builder |
| 5 | `buildMediaMessage(url, type, caption?)` | builder |
| 6 | `whatsapp.service.ts` send methods call builder then provider | refactor |
| 7 | Validate button title ≤20 chars, body ≤1024, ≤3 buttons per Meta limits | builder |

**Acceptance criteria:**
- [x] No inline `type: 'interactive'` JSON in `whatsapp.service.ts` (button/list builders).
- [x] Builder unit tests for payload shape.

**Effort:** 1 day · **Priority:** P2

---

### 5.3 `WhatsAppComponent` type — FAIL → PASS

**Current state:** Type not defined. Buttons passed as ad-hoc arrays.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Define in `whatsapp-turn.types.ts`: | types |
```ts
type WhatsAppComponent =
  | { kind: 'buttons'; buttons: { id: string; title: string }[] }
  | { kind: 'list'; title: string; sections: ListSection[] }
  | { kind: 'media'; url: string; mime: string; caption?: string };

type TurnResult = {
  audience: 'buyer' | 'staff';
  text: string;
  components?: WhatsAppComponent[];
  actionResult?: { action: string; status: 'success' | 'failed' | 'needs_confirmation'; resourceId?: string };
  statePatch?: Record<string, unknown>;
};
```
| 2 | Orchestrator returns `TurnResult`; sender loops `components` through `metaMessageBuilder` | orchestrator |
| 3 | Button policy returns `WhatsAppComponent[]` not raw tuples | buyerButtonPolicy |

**Acceptance criteria:**
- [x] All interactive outbound uses `WhatsAppComponent` type.
- [x] No untyped button arrays in orchestrator path.

**Effort:** 0.5 day (bundled with orchestrator) · **Priority:** P2

---

### 5.4 One outbound per inbound — PARTIAL

**Current state:** AI turn path now resolves `buyerButtonPolicy` components first; skips legacy filter buttons and property media when policy interactive or brochure PDF already sent. Typical turn = text + 0–1 interactive. Full `claimOutboundTurn` + brochure-as-component bundling still pending.

**Implementation plan:**

| Step | Action | File(s) |
|------|--------|---------|
| 1 | Extend `claimOutboundAiReply` → `claimOutboundTurn(companyId, messageId)` — blocks ALL sends for that inbound | `inboundMessageGuard.service.ts` |
| 2 | Orchestrator collects all content into one `TurnResult`: text + at most one component + optional one media | orchestrator |
| 3 | Sender function `sendTurnResult(result)` sends text first, then one component, then one media — all under same turn claim | `whatsapp.service.ts` |
| 4 | Brochure PDF bundled as media component, not separate unguarded send | `brochureDelivery.service.ts` |
| 5 | Property images: send max 1 hero image per turn OR defer to "see photos" button | `whatsapp.service.ts` |
| 6 | Test: count `provider.send*` calls per inbound = ≤3 (text + 1 interactive + 1 media max) | integration test |

**Acceptance criteria:**
- [ ] Typical turn = 1 text message + 0–1 interactive.
- [ ] Turn claim prevents duplicate sends on retry.
- [ ] No unguarded `sendDocument` / `sendImage` outside turn claim.

**Effort:** 2 days · **Priority:** P1

---

## 6. Implementation Phases

### Phase 0 — Safety blockers (P0) · ~2–3 days

| Item | Section |
|------|---------|
| Mutation language guard (no false bookings) | 4.5 |
| Human takeover persistence on WhatsApp | 4.12 |

**Exit:** Buyer never sees false booking claims; takeover actually stops AI.

---

### Phase 1 — Core correctness (P1) · ~5–7 days

| Item | Section |
|------|---------|
| `whatsappTurnOrchestrator` | 4.1, 5.1 |
| Mutation confidence on all paths | 4.3 |
| Visit state machine enforcement | 4.14 |
| Destructive staff confirmation | 4.13 |
| Idempotency all paths | 4.17 |
| One outbound per turn | 5.4 |

**Exit:** Single orchestrator; safe mutations; no duplicate visits; ≤2 WhatsApp messages per turn.

---

### Phase 2 — UX & polish (P2) · ~5–7 days

| Item | Section |
|------|---------|
| Fast-path returning buyer fix | 4.2 |
| Unified sanitizer | 4.10, 4.4 |
| Buyer button policy | 4.6, 4.11 |
| `metaMessageBuilder` + `WhatsAppComponent` | 5.2, 5.3 |
| `metaInboundParser` service | 4.9 |
| Attendance interactive buttons | 4.15 |
| Staff workflow action logs | 4.16 |

**Exit:** Clean buyer UX; attendance buttons; full audit trail.

---

### Phase 3 — Hygiene (P3) · ~1 day

| Item | Section |
|------|---------|
| GreenAPI removal from repo | 4.8 |

**Exit:** Zero GreenAPI references in source.

---

### Total estimated effort: 13–18 dev days

---

## 7. Verification Checklist

Run after each phase. All must pass before calling alignment **PASS**.

### Automated

```bash
cd backend
npx jest --runInBand
npx tsc --noEmit
node scripts/buyer-scenario-runner.mjs --all    # target 12/12
```

### Manual handset scenarios (Palm tenant)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Stranger "Hi" | Welcome + Buy/Rent/Book buttons |
| 2 | Returning buyer "Hi" | Short ack, not full welcome reset |
| 3 | "3bhk whitefield 1.5cr" | Memory patched + property shortlist |
| 4 | "Book lake vista tomorrow 4pm" | Confirm card → success → booked text |
| 5 | Same booking message twice | 1 visit row only |
| 6 | "Cancel my visit" | Confirm → cancelled after success only |
| 7 | Takeover in dashboard | Next buyer msg → handoff, no AI |
| 8 | Release to AI | AI resumes with memory |
| 9 | Staff "scenario buyer didn't visit" | Confirm before no-show |
| 10 | Attendance cron | Buttons → Yes → completed + lead visited |
| 11 | Attendance No | no_show, lead NOT visited |
| 12 | Buyer output audit | No UUID, workflow, match score, grounded |

### Grep audits

```bash
rg "greenapi" backend/src          # → 0
rg "type: 'interactive'" backend/src/services/whatsapp.service.ts  # → 0 after metaMessageBuilder
rg "ensureProspectConversationAiActive" backend/src  # verify takeover guard
```

---

## 8. File Index

### Create (new)

| File | Purpose |
|------|---------|
| `services/whatsapp/whatsappTurnOrchestrator.service.ts` | Central turn brain |
| `services/whatsapp/metaMessageBuilder.service.ts` | Meta payload builder |
| `services/whatsapp/metaInboundParser.service.ts` | Inbound parser |
| `services/whatsapp/whatsappResponseSanitizer.service.ts` | Unified outbound sanitization |
| `services/whatsapp/mutationLanguageGuard.service.ts` | Block false booking claims |
| `services/buyer/buyerButtonPolicy.service.ts` | Buyer button rules |
| `services/copilot/copilotButtonPolicy.service.ts` | Staff button rules |
| `services/copilot/copilotTurnOrchestrator.service.ts` | Staff turn wrapper |
| `services/attendanceWorkflow.service.ts` | Attendance check + buttons |
| `types/whatsapp-turn.types.ts` | TurnResult, WhatsAppComponent |

### Modify (major)

| File | Changes |
|------|---------|
| `services/whatsapp.service.ts` | Slim to send + delegate |
| `services/workflow/workflow-engine.service.ts` | Confidence gate, staff logging, idempotency messages |
| `services/visitState.service.ts` | Enforce transitions |
| `services/agent/agent-router.service.ts` | Use copilotButtonPolicy |
| `services/agent/confirmation.service.ts` | Log resolutions; attendance button IDs |
| `services/agent/cron-scheduler.service.ts` | Use attendanceWorkflow |
| `services/agent/tools/visit-tools.ts` | markNoShow confirm, idempotency |
| `services/visitBooking.service.ts` | Shared idempotency |
| `services/ai.service.ts` | Remove buyer fast-path duplication |
| `routes/conversation.routes.ts` | Takeover sets aiEnabled:false |
| `services/buyerQualification.service.ts` | Returning buyer rapport fix |

### Delete (hygiene)

| File | Reason |
|------|--------|
| `providers/greenapi-whatsapp.provider.ts` | Meta only |
| `routes/greenapi-webhook.routes.ts` | Meta only |
| `tests/unit/*greenapi*` | Legacy |

---

## Summary: PASS vs work remaining

| Status | Count | Action |
|--------|-------|--------|
| **PASS** | 25 areas | Protect during refactor |
| **PARTIAL** | 2 areas | `more-info` multi-send; handset proof pending |
| **FAIL** | 0 areas | — |

**When all PARTIAL and FAIL items reach PASS, Investo will fully match the target model:**

> User asks naturally → orchestrator classifies → workflow/action/tool runs with confidence + confirm + idempotency → one clean sanitized reply with buttons only where needed → every mutation logged → takeover honored → visit state machine enforced.

---

*Generated from deep codebase audit, 2026-06-06. Update this doc as items move to PASS.*
