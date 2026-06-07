# Investo — Implementation Plan

| Field | Value |
|-------|-------|
| Document | Implementation Plan (build order + execution loop) |
| Last updated | 2026-06-07 |
| Current grade | Buyer WhatsApp ~A-/B+, Staff copilot B+, Dashboard A (agentic A-) |

> This plan describes the build chunks (foundation → A+), the gap-driven iterative loop, the test gates, and the deployment process. It consolidates the engineering roadmap with the AI A+ hardening track.

---

## 1. Guiding method

```
AUDIT (once) → [Item: COMPARE code vs ideal → FIX if gap → RECHECK (grep+unit) → TEST → DONE] → next → A+
```

**Rule:** never advance to item N+1 until item N passes its recheck + test gate. Do not ship features outside this loop until the A+ gate is green.

---

## 2. Build chunks (foundational → feature-complete)

| Chunk | Scope | Status |
|-------|-------|--------|
| **1. Foundation** | Scaffolding (FE+BE), Prisma schema + migrations, JWT auth, RBAC middleware, health check | ✅ shipped |
| **2. Multi-tenant core** | Company CRUD, user management, dynamic RBAC, tenant isolation middleware, audit logging | ✅ shipped |
| **3. CRM & properties** | Lead CRUD + status FSM, property CRUD, projects, search/filter | ✅ shipped |
| **4. WhatsApp AI engine** | Meta Cloud API, webhook handler, dedup, language detection, dual-brain AI, property matching, visit booking via chat | ✅ shipped |
| **5. Dashboard & UI** | React app, i18n, responsive layout, all pages, calendar, WebSocket realtime | ✅ shipped |
| **6. Automation & notifications** | Visit reminders, follow-ups, lead auto-creation, notifications, analytics CRON | ✅ shipped |
| **7. Billing & super admin** | Subscription plans, invoices, super admin dashboard, monitoring, platform analytics | ✅ shipped |
| **8. Property import pipeline** | Upload→extract→review→publish, bulk CSV/XLSX, worker queue | ✅ shipped (MVP) |
| **9. AI A+ hardening** | Unified memory, saga, idempotency, clarification logging, one-reply contract, banned-phrase filter, copilot parity | 🔄 in progress |
| **10. Rich media & interactive** | Full WhatsApp media + interactive webhook handling, stage-aware media, EMI flows, price versioning | ⏳ partial / Phase 3–4 |

---

## 3. AI A+ sequential fix queue (Chunk 9)

| # | Item | Fix target | Test gate | Status |
|---|------|-----------|-----------|--------|
| 1 | Prod smoke targets Railway | verify scripts, docs | health curl Railway | ✅ |
| 2 | Mail SMTP on prod | Railway env / SES | `/api/health` mail.ok | ✅ (SES) |
| 3 | RAG sync after buyer memory | `buyer-memory-extract.service.ts` | unit + grep | ✅ |
| 4 | Staff memory write-back | `agent-router.service.ts` | agent tests | ✅ |
| 5 | Clarification logging | `workflow-engine.service.ts` | unit | ✅ |
| 6 | Saga integration test | compensator + engine | npm test compensator | ✅ unit |
| 7 | Idempotency prod proof | idempotency key path | unit + DB query | ⚠️ webhook 200; DB count blocked |
| 8 | Handset baseline (12 scenarios) | matrix script | §6 table | ⚠️ partial |
| 9 | Fix handset buyer failures | buyer memory + visits | re-run rows | 🔄 |
| 10 | Fix handset staff failures | staff copilot | re-run rows | 🔄 |
| 11 | E2E Playwright | login + action logs | `npm run test:e2e` | ⏳ |
| 12 | Per-lead memory panel | lead detail FE | manual UI | ✅ |
| 13 | Viewer read-only copilot | routing service | role test | ✅ |
| 14 | Dashboard copilot API | `POST /api/copilot/chat` | API test | ✅ |
| 15 | Dashboard copilot UI | `/copilot` page | e2e | ✅ |
| 16 | LLM proactive reminders | `automation.service.ts` | unit + cron | ⏳ Phase G |
| 17 | Takeover semantics | product decision + code | §6 row 12 | ⚠️ sign-off pending |
| 18 | Final A+ validation | all gates green | full §5 | ⚠️ in progress |

---

## 4. Multi-reply / quality hardening (recent work)

Completed against `backend/docs/fix.md`:
- **One-reply-per-turn contract** — `claimPrimaryOutboundSend` / `beginOutboundTurn`; all interactive flows return a single `TurnResult` dispatched via `sendTurnResult`.
- **Legacy direct-send removal** — visit-time-slot handling migrated into `whatsappInteractiveOrchestrator.service.ts`.
- **LLM parameter hardening** — `BUYER_LLM_SAFE_PARAMS` (temp 0, max_tokens 300, penalties, json_object) applied to every buyer LLM call.
- **Global rules injection** — `AI_GLOBAL_RULES_BLOCK` in system prompt.
- **Stage-bleed guard** — `isAllowedStageTransition` blocks invalid stage regressions; visit_booking prompt modifiers.
- **Banned-phrase filter + safe fallback** — `buyerBannedPhraseFilter.util.ts`, `safeBuyerFallback.util.ts` wired into `whatsappResponseSanitizer.service.ts` (pre + post pipeline).
- **Stage-aware fast path** — greetings suppressed during booking stages.

Proven via unit tests: `outbound-fix-proof`, `outbound-turn-budget`, `buyerBannedPhraseFilter.util`, `conversationStateMachine.transition`, `whatsapp-response-sanitizer`, `ai.service.fallback`, `customerMessageFastPath`.

---

## 5. Test matrix (run after every change)

### 5.1 Automated (must be 100% green)
```powershell
cd backend
npm test                              # full unit suite
npm test -- workflow-scenario-matrix  # 49+ phrase→workflow
npm test -- buyer-memory-extract agent-action-log workflow-engine
npm run build

cd ..\frontend
npm test                              # component/page tests
npm run build
npm run test:e2e                      # Playwright (when CI secrets present)
```
Baseline reference: backend ~678 unit / frontend ~75 passing.

### 5.2 Production smoke (Railway)
```powershell
$base = "https://investo-backend-production.up.railway.app"
curl.exe -s "$base/api/health/live"
curl.exe -s -o NUL -w "agent-action-logs: %{http_code}`n" "$base/api/agent-action-logs"
curl.exe -s "$base/api/health" | findstr mail
```

### 5.3 Handset acceptance (12 scenarios — A+ gate)
Run on a real WhatsApp handset against Railway production: brochure send, book visit, duplicate book (idempotency), reschedule, budget recall, visit-time query, staff "visits today", staff status update, LLM-off CRM, admin action logs page, injected failure → reconciliation, takeover behavior. **Gate: 11/12 ✅ (+1 waived).**

### 5.4 DB proof queries
```sql
SELECT lead_memory FROM leads WHERE phone = '<buyer_phone>';
SELECT action, status, inputs FROM agent_action_logs WHERE company_id = '<id>' ORDER BY created_at DESC LIMIT 20;
SELECT COUNT(*) FROM visits WHERE lead_id = '<lead_id>' AND scheduled_at = '<slot>';
```

---

## 6. Deployment process

```powershell
# Backend (Railway, git redeploy)
$env:RAILWAY_TOKEN = '<account-token>'
.\scripts\deploy-railway-backend.ps1

# Backend (local upload of uncommitted changes)
$env:RAILWAY_ACCOUNT_TOKEN = '<account-token>'
.\scripts\deploy-railway-upload.ps1

# Frontend (Vercel)
cd frontend
npx vercel deploy --prod --yes
```

Pre-deploy: full §5.1 green + `npm run build`. Post-deploy: §5.2 smoke + handset rows affected by the change.

---

## 7. Phased timeline (A+ track)

| Phase | Focus | Exit criteria |
|-------|-------|---------------|
| A | Audit + infra | Gap report; Railway smoke; mail ok |
| B | Memory unification | Single `lead_memory`; RAG synced; handset memory rows |
| C | Saga + idempotency | Compensators; duplicate → one visit |
| D | Intent + telemetry | Clarification logged; scenario matrix |
| E | Staff hardening | Viewer read-only copilot; LLM-off CRM |
| F | Dashboard copilot | `/api/copilot/chat` + UI parity |
| G | Final A+ | 12/12 handset; full suite green |

Estimate: ~10 weeks full-time / ~20 weeks part-time.

---

## 8. Rich media & ingestion roadmap (Chunk 10)

| Phase | Deliverable |
|-------|-------------|
| MVP | Store brochure/image/floor-plan/price-list URLs; manual import + edit; human review before publish |
| Phase 2 | Per-company Excel/CSV mapping; OCR/table extraction; draft confidence + review queue |
| Phase 3 | WhatsApp image/document/location/button delivery; interactive webhook handling; stage-aware media selection |
| Phase 4 | EMI calculator deep flows; price versioning + active-offer windows; conversion-by-media analytics |

Design rules: never overwrite price history (version with effective dates); AI answers only from approved active inventory; per-company field-mapping profiles; async background processing for OCR/spreadsheet jobs.

---

## 9. Risk register & mitigations

| Risk | Mitigation |
|------|-----------|
| Cross-tenant leakage | `company_id` enforced in middleware + every query; negative tests |
| Multi-reply syndrome | One-reply contract + `claimPrimaryOutboundSend` |
| AI hallucination | Grounding guard, banned-phrase filter, temp 0, approved-inventory-only |
| Double booking | Idempotency keys + saga |
| OCR mistakes | Confidence scores + human review before publish |
| Stale prices | Effective dates + freshness checks |
| LLM provider outage | Provider fallback chain + safe fallback (no invented outage) |
| Webhook flood | Signature verify + rate limit + dedup |
| Broken media links | Signed HTTPS URLs + fallback text |

---

## 10. Definition of done (per feature)

1. Code + unit tests written and green.
2. `company_id` filter present on all tenant queries; RBAC + feature gate enforced.
3. State transitions validated against the relevant FSM.
4. Linting clean; build passes.
5. Action/audit logging added for autonomous or write operations.
6. Production smoke + (for AI-touching changes) affected handset rows pass.
7. Docs updated (this plan + relevant `docs/` file).

---

## 11. What not to claim until the A+ gate is green

- "AI never double-books" / "AI remembers everything" / "every failure auto-rolls back."
- "Fully end-to-end WhatsApp media/button sending for all companies."
- "Fully live Excel price syncing for all companies."

**Safe to claim today:** core WhatsApp buyer + staff flows work; one-reply contract enforced; unified memory + saga + idempotency implemented and unit-proven; action logs live; dashboard copilot parity shipped.
