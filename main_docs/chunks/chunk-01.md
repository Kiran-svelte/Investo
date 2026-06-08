# Chunk 01 — Inbound Pipeline Guards (full.md PART I)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Field | Value |
|-------|-------|
| Chunk | 01 of 15 |
| full.md | **PART I** — Inbound Pipeline (§I.1–I.10) |
| Status | **Done** |
| Est. PR size | ~400–600 LOC touched across 3 files |

---

## 1. Objective

**Remove** ad-hoc inbound guard logic scattered in `whatsapp.service.ts` and **replace** with a single, testable pipeline that matches full.md PART I exactly:

- Company resolution → dedup → staff intercept → fingerprint → concurrent lock → lead upsert → message persist → route to interactive/orchestrator

**Do NOT** change handler logic (H0–H9), interactive handlers, AI generation, or outbound send in this chunk.

---

## 2. Files IN SCOPE (exclusive edit list)

| File | What you may change |
|------|---------------------|
| `backend/src/services/whatsapp.service.ts` | **Only** `handleIncomingMessage` from company resolution through `beginOutboundTurn` / lead+conversation bootstrap / customer message insert / branch to interactive vs orchestrator. **Do not edit** `sendTurnResult`, `handleInteractiveAction` body, or staff copilot paths beyond the intercept block already at top of handler. |
| `backend/src/services/inboundMessageGuard.service.ts` | Dedup claim/release functions only |
| `backend/src/services/customerInboundQueue.service.ts` | FIFO queue + drain + retry scheduling |
| `backend/src/services/whatsapp/inboundGuardPipeline.service.ts` | **NEW** — Layers 1–5 extracted from handleIncomingMessage |
| `backend/src/tests/unit/whatsapp.inbound-processing.test.ts` | Update mocks/assertions for refactored pipeline |
| `backend/src/tests/unit/customerInboundQueue.test.ts` | **Create if missing** — queue/drain tests |

---

## 3. Files READ-ONLY (call but do not edit)

| File | Why |
|------|-----|
| `backend/src/routes/webhook.routes.ts` | Webhook ACK; calls `handleIncomingMessage` |
| `backend/src/services/inboundWhatsAppRouting.service.ts` | Staff route (Chunk 14 owns changes) |
| `backend/src/services/visitPendingApproval.service.ts` | Approval intercept handlers |
| `backend/src/services/callRequest.service.ts` | Call approval intercept |
| `backend/src/services/leadAssignment.service.ts` | `assignLeadWithRouting` on new lead |
| `backend/src/services/socket.service.ts` | `LEAD_CREATED` emit |
| `backend/src/services/automationQueue.service.ts` | `retry_concurrent_inbound` job |
| `backend/src/config/redis.ts` | Redis client |

---

## 4. Files CALLERS (who depends on this chunk)

```
webhook.routes.ts
  └── whatsappService.handleIncomingMessage(msg)
        └── [THIS CHUNK] guards + lead/conversation + route
              ├── handleInteractiveAction()     ← Chunk 08 (unchanged here)
              └── orchestrateWhatsAppBuyerTurn() ← Chunk 03+ (unchanged here)
```

---

## 5. Connection diagram (full.md PART I)

```
handleIncomingMessage(msg)
│
├─ [S] getCompanyByPhoneNumberId(msg.phoneNumberId)
│     └─ miss → return { status:'skipped', reason:'company_not_found' }
│
├─ [S] claimInboundMessageFull(companyId, msg.messageId)
│     └─ false → return { status:'skipped', reason:'duplicate_message_id' }
│
├─ [S] Staff approval intercept (visit-approve|decline, call-approve|decline)
│     └─ staff user → approval handler → return processed
│
├─ [S] routeCompanyScopedInbound(...)
│     └─ handled → return processed (copilot/staff)
│
├─ [S] claimCustomerInboundFingerprint (SKIP if interactiveId)
│     └─ false → return duplicate_customer_fingerprint
│
├─ [S] claimCustomerProcessingTurn (SKIP lock if interactiveId)
│     └─ false → enqueueCustomerInbound + retry_concurrent_inbound +4s
│
├─ [S] beginOutboundTurn(...)
│
├─ try:
│   ├─ [D] Find/create lead (exact phone → last10 → upsert)
│   ├─ [D] Find/create conversation (ai_active, rapport)
│   ├─ [D] Insert customer message (dedup layers)
│   ├─ [S] ensureProspectConversationAiActive
│   ├─ branch: interactiveId → handleInteractiveAction
│   └─ branch: text → orchestrateWhatsAppBuyerTurn
│
├─ catch: releaseInboundMessageFull on failure
│
└─ finally: releaseCustomerProcessingTurn + drainCustomerInboundQueue
```

---

## 6. Algorithm — guard layers (implement exactly)

### Layer 1 — Message ID dedup (full.md §I.2)

**Algorithm:**
1. If `msg.queuedReplay === true` → skip Redis/DB claim (replay from queue).
2. Call `claimInboundMessageFull(companyId, whatsappMessageId)`.
3. On failure → exit early; Meta retry is OK after TTL/release.

**Redis key:** `inbound:{companyId}:{messageId}` (via inboundMessageGuard)

**DB:** `inbound_whatsapp_dedup` unique `(companyId, whatsappMessageId)`

**If it breaks:**
- Duplicate replies to customer → claim TTL too short or release not called on error.
- Meta retries dropped forever → forgot `releaseInboundMessageFull` in catch.

**Debug:** Log `reason: duplicate_message_id` with masked phone + messageId.

---

### Layer 2 — Staff approval intercept (full.md §I.3)

**Precondition:** `interactiveId` starts with `visit-approve-|visit-decline-|call-approve-|call-decline-`

**Algorithm:**
1. `findCompanyUserByPhone(customerPhone, companyId)`
2. If not staff → fall through to prospect pipeline (buyer tapping agent button is rare; log warning).
3. Route to `tryHandleVisitApprovalInteractive` or `tryHandleCallApprovalInteractive`.
4. Return `{ status:'processed', reason:'visit_approval_handled' | 'call_approval_handled' }`

**Do not move** this block below prospect lead creation.

**If it breaks:**
- Agent tap creates spurious lead → intercept runs after lead upsert (wrong order).

---

### Layer 3 — Staff copilot route (full.md §I.4)

**Algorithm:** `routeCompanyScopedInbound({ senderPhone, messageText, companyId, interactiveId, inboundMessageId })`

If `handled === true` → return immediately; **never** auto-create lead for staff phones.

**If it breaks:**
- Agent "Hi" triggers buyer H2 → staff route not running or phone not on user profile.

---

### Layer 4 — Text fingerprint dedup (full.md §I.5)

**Precondition:** `!msg.interactiveId?.trim() && !msg.queuedReplay`

**Algorithm:**
1. Hash normalized text → `claimCustomerInboundFingerprint(companyId, phone, text)`
2. TTL **90s** — prevents double webhook delivery of same text.

**Skip for interactive:** Button titles repeat ("Call Me"); fingerprint would false-positive.

**If it breaks:**
- Customer sends same text twice in 90s legitimately → second silently dropped (by design per full.md).

---

### Layer 5 — Concurrent processing lock (full.md §I.6)

**Algorithm:**
```
if (interactiveId) {
  customerTurnClaimed = true;  // bypass lock
} else {
  customerTurnClaimed = await claimCustomerProcessingTurn(companyId, phone);
}
if (!customerTurnClaimed) {
  enqueueCustomerInbound(...);  // FIFO list
  schedule retry_concurrent_inbound +4s fallback;
  return { status:'skipped', reason:'concurrent_customer_processing' };
}
```

**Redis key:** `customer-processing:{companyId}:{phoneLast10}` TTL **60s**

**Queue key:** `customer-inbound-queue:{companyId}:{phoneLast10}` TTL **3600s**

**Drain:** In `finally`, `drainCustomerInboundQueue` replays with `queuedReplay=true`.

**If it breaks:**
- Second message lost → enqueue not called (historical bug; full.md requires queue).
- Infinite replay loop → drain without clearing claim or missing dedup on replay messageId.

**Debug:** `logOutboundBranch('H2', 'whatsapp.service.ts:concurrent', 'concurrent_customer_blocked', ...)`

---

### Layer 6 — Lead resolution (full.md §I.7)

**Algorithm:**
1. `findFirst({ companyId, phone: exact })`
2. Miss → `findFirst({ companyId, phone: { endsWith: last10 } }, orderBy updatedAt desc)`
3. If found with different format → update phone to normalized E.164
4. Still miss → `upsert` unique `(companyId, phone)`:
   - `assignLeadWithRouting(companyId, { metadata: { source_detail } })`
   - `notification` type `lead_new`
   - `notifyAgentOfNewLead` if assigned
   - `socketService.emitToCompany(LEAD_CREATED)`
   - `logAgentAction('autoCreateLeadFromWhatsApp')`

**source_detail:** `wa_interactive:{id}` or `whatsapp_inbound`

**If it breaks:**
- Duplicate leads on concurrent first message → upsert must use unique constraint.
- Wrong agent assigned → routing service issue (out of scope; don't change assignment here).

---

### Layer 7 — Conversation bootstrap (full.md §I.8)

**Algorithm:** Find open conversation for lead or create:
- `status: 'ai_active'`
- `aiEnabled: true`
- `stage: 'rapport'`
- `commitments`: from `conversationStateManager.createInitialState()`

**If it breaks:**
- New message opens second conversation thread → find query must use leadId + not closed.

---

### Layer 8 — Customer message persist (full.md §I.9)

**Dedup layers (in order):**
1. Existing row with same `whatsappMessageId` → skip insert
2. `prisma.message.create` customer row
3. P2002 on unique whatsappMessageId → skip
4. Duplicate content within **90s** same conversation → skip (`duplicate_customer_content`)

**Wrong-number path:** If message matches wrong-report pattern → `handleWrongReport` + WRONG_ACK (keep existing behavior; do not remove).

---

### Layer 9 — AI reactivation + route (full.md §I.10)

**Algorithm:**
1. `ensureProspectConversationAiActive(conversation)` — re-enable AI unless manual takeover.
2. Reset legacy `human_escalated` stage → `rapport` (if still present in DB).
3. If `interactiveId` → `this.handleInteractiveAction(...)` (delegate unchanged).
4. Else → build context + `orchestrateWhatsAppBuyerTurn(...)` (delegate unchanged).

---

## 7. What to REMOVE (existing logic to delete in-scope)

Search within **only** the inbound block of `whatsapp.service.ts`:

| Remove / consolidate | Reason |
|---------------------|--------|
| Duplicate dedup checks that bypass `claimInboundMessageFull` | Single Layer 1 entry point |
| Inline Redis lock logic not using `customerInboundQueue.service.ts` | Centralize FIFO |
| Early returns that skip `releaseInboundMessageFull` on error | full.md §I.2 release on catastrophic failure |
| Lead creation code duplicated outside upsert path | One §I.7 path |
| Debug `fetch` to localhost / agent log noise | Production hygiene |

**Do not remove:** Staff intercept, wrong-report handler, `beginOutboundTurn`, socket emits.

---

## 8. What to ADD

| Addition | Location |
|----------|----------|
| `runInboundGuardPipeline(ctx): GuardResult` | New private method or `inboundPipeline.service.ts` **only if** you create it in this chunk — if created, add to IN SCOPE list in PR description; prefer keeping in whatsapp.service.ts private methods to respect boundary |
| Structured return type for skip reasons | Align with full.md PART XVII rows 1–5 |
| `finally` block guarantee | Always `releaseCustomerProcessingTurn` + `drainCustomerInboundQueue` |
| Unit test: concurrent → queue → replay | `whatsapp.inbound-processing.test.ts` |

Optional extraction (allowed in this chunk only):

```
backend/src/services/whatsapp/inboundGuardPipeline.service.ts  (NEW)
  - export runInboundGuards(...)
  - called only from whatsapp.service.ts handleIncomingMessage
```

If you extract, **whatsapp.service.ts** only replaces inline guards with one import call — no other behavioral change.

---

## 9. Implementation steps (ordered)

1. **Read** full.md PART I and mark line ranges in `whatsapp.service.ts` `handleIncomingMessage`.
2. **Write** characterization tests for current skip reasons (if missing).
3. **Refactor** Layer 1–3 without changing order.
4. **Refactor** Layer 4–5; verify interactive bypass with test.
5. **Refactor** Layer 6–8 lead/conversation/message; keep socket + notification calls identical.
6. **Ensure** catch calls `releaseInboundMessageFull(companyId, msg.messageId)`.
7. **Ensure** finally drains queue.
8. **Run** tests listed in §12.

---

## 10. Debug instrumentation

| Hook | When |
|------|------|
| `logger.info('Inbound skipped', { reason, companyId, messageId })` | Every early return |
| `logOutboundBranch('H2', 'whatsapp.service.ts:concurrent', ...)` | Concurrent block |
| `logAgentAction('autoCreateLeadFromWhatsApp')` | New lead |
| Redis key logged at **debug** level only | Never log full phone |

Add **temporary** trace ID (optional): `inboundTraceId = messageId.slice(-8)` passed to orchestrator in later chunks — if added here, only add field to context object, do not change orchestrator.

---

## 11. Failure modes & recovery (full.md PART XVII)

| # | Symptom | Cause | Recovery |
|---|---------|-------|----------|
| 1 | No reply, logs `company_not_found` | Wrong `phoneNumberId` on Meta | Fix company settings / env |
| 2 | No reply, `duplicate_message_id` | Meta retry while claim held | Expected; or release on crash missing |
| 3 | No reply, `duplicate_customer_fingerprint` | Same text within 90s | Expected; customer must wait or rephrase |
| 4 | Delayed reply ~4–65s | `concurrent_customer_processing` | Expected; verify queue drain |
| 5 | No reply, `duplicate_customer_content` | Echo webhook | Expected |
| 6 | 500, customer can retry | Uncaught exception | Fix bug; releaseInboundMessageFull must run |
| 13 | Stuck, no Meta retry | Claim not released on crash | releaseInboundMessageFull in catch |

---

## 12. Verification checklist

### Unit tests (must pass)

```bash
cd backend
npm test -- --testPathPattern="whatsapp.inbound-processing|customerInboundQueue|inboundMessageGuard"
```

| Test case | full.md E2E |
|-----------|-------------|
| Unknown company → skip | — |
| Duplicate messageId → skip | — |
| Concurrent text → queue + replay | `buyer-09-concurrent` |
| Interactive bypasses lock | `buyer-int-filter` |
| New lead upsert + LEAD_CREATED | `buyer-01-rapport` (setup) |

### Manual smoke

1. Send `Hi` from new number → lead created, one reply (handler tested in Chunk 04).
2. Send two texts within 1s → second processed after ~4s or via drain.
3. Agent taps `visit-approve-*` → no new lead row.

---

## 13. Definition of Done

- [x] All guard layers match PART I order and skip reasons
- [x] No edits outside IN SCOPE files
- [x] H0–H9 and interactive bodies unchanged
- [x] Unit tests green (15/15)
- [ ] `e2e-handset-proof.mjs` **buyer-09-concurrent** still passes (or unchanged fail documented)
- [x] Code review confirms boundary rule quoted in PR

---

## 14. Rollback

Revert PR. Guards are stateless except Redis TTL keys — no migration rollback needed.

If partial failure in prod: disable concurrent queue drain via env **not recommended**; instead redeploy previous image.

---

## 15. Next chunk

After Done → [chunk-02.md](./chunk-02.md) (Session taxonomy: `hasPriorOutbound`, `/start`, returning buyer detection).
