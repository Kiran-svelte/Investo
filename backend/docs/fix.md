# Investo AI Production Standards — `fix.md`

> **Purpose:** Single reference for how Investo buyer/staff AI **should** behave, what is **already enforced in code**, and what **still needs work**.  
> **Audience:** Product, ops, and engineers shipping WhatsApp + dashboard AI.  
> **Last updated:** 2026-06-07  
> **Companion:** `AI_SURFACES.md`, `AI_ALIGNMENT_AUDIT_AND_FIX_PLAN.md`, `AI_OPERATIONS_BIBLE.md`

---

## 0. One-line verdict (June 2026)

Investo is a **bounded business assistant** (NL → classify/workflow → guarded reply), not a generic chatbot. Core visit booking, staff copilot, sanitization, and orchestrator extraction are **production-grade**. Recent fixes closed **call-vs-visit collision** and **staff copy leaking to buyers**. Remaining gaps are mostly **property context resolution**, **duplicate outbound on workflow+LLM edge cases**, and **handset proof automation**.

---

## 1. Shipped in code (2026-06-07)

| Fix | User symptom | Implementation | Key files |
|-----|--------------|----------------|-----------|
| **Call time ≠ visit time** | User taps *Change Time* on call → replies `9 pm today` → bot says “could not schedule **visit**” | `awaitingCallTime` on conversation; visit scheduling ignores bare `today/tomorrow + time`; call commit accepts bare time replies | `conversationCallContext.util.ts`, `visitIntentFromMessage.service.ts`, `customerCallBooking.service.ts`, `whatsappInteractiveOrchestrator.service.ts` |
| **Staff upload instructions to buyers** | “Upload one in property settings” on buyer WhatsApp | Buyer sanitizer + workflow reply scrub + brochure tool `channel: 'buyer'` + AI prompt rule 6c | `buyerStaffCopyGuard.util.ts`, `whatsappResponseSanitizer.service.ts`, `brochure-tools.ts`, `ai.service.ts` |
| **Property import location** | Publish step warned about location but had no inputs | City / area / pincode on Step 5 Publish; geocode on publish | `PropertyImportLocationFields.tsx`, `propertyImport.service.ts` |
| **Call booking (buyer)** | *Call Me*, reschedule, cancel | `call_requests` table + `tryCommitCustomerCallBooking` before LLM | `callRequest.service.ts`, `customerCallBooking.service.ts` |
| **Staff message forward** | `send "Hi" to 903…` | Staff-only forward service | `staffMessageForward.service.ts` |
| **Buyer copy polish** | Signatures, robotic openers, dismissal spam | Sanitizer strips; dismissal fast-path | `whatsappResponseSanitizer.service.ts`, `whatsappTurnOrchestrator.service.ts` |

**Deploy note:** Backend must rebuild on Railway (`backend/src/**` watch paths). If logs show *“no changes detected in watch paths, build will skip”*, bump the marker in `backend/src/app.ts` and redeploy.

---

## 2. Architectural rules — status

| Rule | Target | Status | Where enforced |
|------|--------|--------|----------------|
| **One reply per user message** | Single WhatsApp payload per turn | **Partial** | `sendTurnResult`, `enforceTurnComponentBudget`; edge case: workflow fail + LLM both fire if visit path mis-classifies |
| **Deterministic before LLM** | Fast-paths first | **Shipped** | `whatsappTurnOrchestrator.service.ts` H1–H8 before H9 |
| **State machine owns stage** | LLM fills wording only | **Shipped** | `conversationStateMachine.ts`, `ai.service.ts` stage prompts |
| **Idempotent webhook** | Dedup by `message_id` | **Shipped** | `claimInboundMessageFull` |
| **Destructive ops need confirm** | Staff YES/NO | **Shipped** | Pending confirmation in `agent-router.service.ts` |
| **No staff ops copy to buyers** | No dashboard/upload/settings | **Shipped** (2026-06-07) | `buyerStaffCopyGuard.util.ts` |
| **Call vs visit separation** | Callback time never books site visit | **Shipped** (2026-06-07) | See §1 |

---

## 3. Buyer WhatsApp — correct turn order

Production order in `orchestrateWhatsAppBuyerTurn`:

```
H1  Human takeover (terminal)
    tryCommitCustomerVisitBooking  (deterministic)
    tryCommitCustomerCallBooking   (deterministic — must run same turn)
H2  handleCallCommitReplyTurn     (if call committed → STOP)
H3  Dismissal / rapport / memory / qualify
H4  Visit status (deterministic)
H5  Visit workflow suggestion (schedule_visit, etc.)
H6  Classifier workflow
H7  Visit commit reply
H8  Full AI (LLM) — only if nothing above handled
```

**Investo rule:** After *“share your preferred call time”*, the next message with only a time (`9 pm today`) must hit **call commit**, not `schedule_visit`.

---

## 4. Brochure requests — buyer vs ops

| Actor | When PDF missing | Correct message |
|-------|------------------|-----------------|
| **Buyer** | No `brochureUrl` on property | “I don't have a brochure PDF in chat yet — I can share pricing/photos or our team can send it.” |
| **Staff (copilot)** | Same | “Upload one in Investo dashboard (Properties), then I can send it to the customer.” |
| **Ops / admin** | Data gap | Upload PDF in **Properties → edit listing** (not a code fix) |

**Never** tell a buyer to use property settings, dashboard, or upload files.

---

## 5. Property import — location for WhatsApp matching

| Step | Field | Required? |
|------|-------|-----------|
| Publish (Step 5) | City and/or area | Optional but **strongly recommended** |
| Publish (Step 5) | Pincode | Optional |
| On publish | Auto-geocode → `latitude` / `longitude` | When city/area present |

Without location, WhatsApp AI can still answer but **location queries** (“2 BHK in Whitefield”) match poorly.

---

## 6. LLM hardening — global targets

Apply on **every** LLM call (buyer, staff classifier, LangGraph):

| Parameter | Target | Status |
|-----------|--------|--------|
| `temperature` | 0 for mutations / classifiers | Partial — verify all callers |
| `response_format` | `json_object` where structured | Buyer AI: shipped |
| `max_tokens` | ≤300 buyer replies | Prompt rule 8 |
| Pre-parsed datetime | Use injected ISO, don’t re-parse | `extractedDateTime` in `ai.service.ts` |

**System prompt global rules** (all buyer/staff prompts):

1. Respond once per user message.  
2. Never invent outages or “connection issues”.  
3. No repeat welcome mid-conversation.  
4. No capability menus (“Here’s how I can help”).  
5. Missing facts → offer agent; don’t guess.  
6. Destructive actions → wait for YES/NO.  
7. **Never tell buyers to upload or use property settings** (rule 6c, 2026-06-07).

---

## 7. Post-processing filter (last line of defense)

Runs on buyer outbound via `sanitizeBuyerOutbound`:

- Strip UUIDs, match scores, workflow names (`stripBuyerInternalMetadata`)
- Strip staff instructions (`sanitizeStaffInstructionsForBuyer`)
- Never-say-no guard + mutation language guard
- Remove trailing “— Company via Investo” signatures
- Strip robotic openers (“I'm here to assist…”)

**Banned phrases to alert on in prod:** `property settings`, `Upload one in`, `try from the dashboard`, `Welcome back` (mid-thread), numbered capability lists.

---

## 8. Known gaps (still open)

| # | Gap | Symptom | Priority | Next step |
|---|-----|---------|----------|-----------|
| G1 | **Wrong property context** | Brochure for “Palm Villa” answers about Green Acres | P1 | Improve fuzzy match in `buyerPropertyContext.service.ts`; prefer message entity over stale `selectedPropertyId` |
| G2 | **Workflow + LLM same turn** | Visit error message then long LLM essay | P2 | Short-circuit H9 when H6 returns terminal reply |
| G3 | **Railway skip build** | Deploy uploads but old code runs | P1 | Bump `app.ts` marker; verify build logs show `tsc` |
| G4 | **Handset matrix** | ADB proof flaky | P2 | Webhook-based proof scripts (`manual-ux-quality-proof.mjs`) |
| G5 | **Returning buyer “Hi”** | Full welcome replay | P2 | Partially fixed; scenario #1 in matrix |
| G6 | **Property name typo** | “plam villa” miss | P2 | Fuzzy catalog search in brochure workflow |

---

## 9. Verification checklist (after deploy)

Run after every production backend deploy:

```bash
# Health
curl -s https://investo-backend-production.up.railway.app/api/health/live

# Unit (backend)
cd backend && npx jest src/tests/unit/callIntentFromMessage.util.test.ts \
  src/tests/unit/visitIntentFromMessage.service.test.ts \
  src/tests/unit/buyerStaffCopyGuard.util.test.ts

# Manual WhatsApp (buyer phone released to AI first)
# 1. Tap Call Me → Change Time → reply "9 pm today" → expect CALLBACK copy, not "visit"
# 2. "Send brochure for [project]" → no "property settings" / "upload"
# 3. Property import Step 5 → enter city/area → blur to save → publish
```

Frontend (location UI): https://biginvesto.online → Properties → Import → Step 5 Publish.

---

## 10. Operational runbook

| Symptom | Immediate action | Permanent fix |
|---------|------------------|---------------|
| Call time books a visit | Check `commitments.awaitingCallTime` in DB; redeploy backend ≥ `b777db3b4` | §1 call-vs-visit |
| Buyer sees “property settings” | Check outbound in `messages` table; redeploy sanitizer | §4 + `buyerStaffCopyGuard` |
| Two AI bubbles same minute | Grep logs for workflow + `H9` same `message_id` | G2 |
| Deploy says “build will skip” | Bump `backend/src/app.ts` marker comment | §1 deploy note |
| Brochure PDF missing | Admin uploads in Properties UI | Ops data, not code |
| Staff gets dashboard message | Expected for non-copilot roles | `inboundWhatsAppRouting.service.ts` |

---

## 11. “Perfectly working” checklist (Investo-adapted)

An AI surface is **production-ready** when:

| Aspect | Pass criteria |
|--------|---------------|
| Intent | One intent per turn; mutations above confidence threshold |
| Tool/workflow | Matches intent; parameters validated |
| Idempotency | Duplicate webhook → same outcome |
| State | Stage matches history; no call/visit bleed |
| Memory | Lead memory updated after meaningful turns |
| Response | **One** outbound; no staff copy; no internal IDs |
| Performance | p95 < 3s where possible |
| Observability | `agent_action_logs` for mutations |

---

## 12. References

| Topic | Doc / file |
|-------|------------|
| Surface map | `AI_SURFACES.md` |
| Audit scorecard | `AI_ALIGNMENT_AUDIT_AND_FIX_PLAN.md` |
| Ops routing | `AI_OPERATIONS_BIBLE.md` |
| Orchestrator | `walkthrough.md` |
| Buyer turn | `whatsappTurnOrchestrator.service.ts` |
| Call booking | `customerCallBooking.service.ts`, `callRequest.service.ts` |
| Import location | `PropertyImportLocationFields.tsx`, `propertyImport.service.ts` |
