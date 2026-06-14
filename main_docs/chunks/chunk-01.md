# Chunk 01 — Multi-Visit Live Context Registry

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Field | Value |
|-------|-------|
| Chunk | 01 of 10 |
| Workstream | Enterprise Multi-Project Buyer UX |
| Status | **Done** |
| Est. PR size | ~350–500 LOC across 4 files |
| Feature flag | `FEATURE_MULTI_VISIT_CONTEXT` (default **OFF**) |
| Depends on | Enterprise v2 baseline (2026-06-14) |
| Blocks | Chunks 05, 08, 09, 10 |

---

## 1. Objective

**Replace** the single-slot `activeVisit: ActiveVisitContext | null` model with a **visit registry** that exposes all upcoming visits for a lead, while preserving backward-compatible `activeVisit` as the *primary* visit for existing callers.

**Why:** With multiple projects, a buyer may have:

- Sunset Heights visit Saturday 4 PM (confirmed)
- Lake Vista visit Saturday 6 PM (scheduled)

Today `getLiveLeadContext` returns only the first matching visit:

```139:164:backend/src/services/liveLeadContext.service.ts
    const upcoming = (lead.visits ?? []).find(
      (v) =>
        ['scheduled', 'confirmed', 'rescheduled'].includes(v.status) &&
        new Date(v.scheduledAt) >= new Date(now.getTime() - 2 * 60 * 60 * 1000),
    );
    const activeVisit = upcoming ? toVisitContext(upcoming) : null;
```

Confirm/reschedule/cancel and AI prompt injection then operate on the **wrong** visit. Spec reference: `.kiro/specs/ai-agent-production-standards/bugfix.md` row **6.1**.

**Do NOT** in this chunk: change disambiguation UX (Chunk 05), conversation focus (Chunk 02), or button policy.

---

## 2. Files IN SCOPE (exclusive edit list)

| File | What you may change |
|------|---------------------|
| `backend/src/services/liveLeadContext.service.ts` | Add `upcomingVisits[]`, extend prompt block, keep `activeVisit` compat |
| `backend/src/tests/unit/liveLeadContext.service.test.ts` | **CREATE** if missing — multi-visit cases |
| `backend/src/tests/unit/buyerEnterpriseUx.service.test.ts` | Update mocks if `LiveLeadContext` shape extended |
| `backend/src/config/index.ts` | Add `multiVisitContext: process.env.FEATURE_MULTI_VISIT_CONTEXT === 'true'` |

---

## 3. Files READ-ONLY (call but do not edit)

| File | Why |
|------|-----|
| `backend/src/services/buyer/buyerEnterpriseUx.service.ts` | Chunk 08 extends `buildBuyerCrmButtonFlags` |
| `backend/src/services/whatsapp/whatsappTurnOrchestrator.service.ts` | Consumes `liveCtx` — unchanged until Chunk 04 |
| `backend/src/services/visitMutationFromChat.service.ts` | Chunk 05 uses registry |
| `backend/src/services/ai.service.ts` | Reads `liveLeadContextBlock` string only |

---

## 4. Files CALLERS (who depends on this chunk)

```
getLiveLeadContext(leadId, companyId)
  ├── whatsappTurnOrchestrator.service.ts → buyerButtonContextFromTurn, H9 prompt
  ├── customerMessageFastPath.service.ts → visit-aware greeting
  ├── ai.service.ts → liveLeadContextBlock injection
  ├── buyerEnterpriseUx.service.ts → buildBuyerCrmButtonFlags(liveCtx)
  └── whatsappInteractiveOrchestrator.service.ts → handleMoreInfo (direct prisma today; Chunk 09 aligns)
```

**Contract:** Existing callers reading `activeVisit` alone must behave identically when flag OFF or when lead has ≤1 upcoming visit.

---

## 5. Connection diagram

```
getLiveLeadContext
│
├─ [D] prisma.lead.findFirst + visits (increase take: 5 → 10 when flag ON)
│
├─ [S] Filter upcoming visits (scheduled|confirmed|rescheduled, within window)
│     └─ flag OFF → .find() → activeVisit (legacy)
│     └─ flag ON  → .filter() → upcomingVisits[]
│
├─ [S] Pick primary activeVisit:
│     1. Soonest scheduledAt in future (or within 2h grace past)
│     2. Tie-break: confirmed > scheduled > rescheduled
│     3. Same as legacy .find() order when only one exists
│
├─ [S] pending_approval visit (unchanged path)
│
├─ [S] buildPromptBlock:
│     └─ flag OFF → current single-visit block
│     └─ flag ON  → "### Upcoming Site Visits (N)" list + primary visit emphasis
│
└─ return LiveLeadContext { activeVisit, upcomingVisits, ... }
```

---

## 6. Type changes

### 6.1 Extend `LiveLeadContext`

```typescript
export interface LiveLeadContext {
  // ... existing fields ...
  /** All upcoming visits ordered by scheduledAt ASC. Empty when flag OFF and legacy path. */
  upcomingVisits: ActiveVisitContext[];
}
```

### 6.2 Backward compatibility rule

| Condition | `upcomingVisits` | `activeVisit` |
|-----------|------------------|---------------|
| Flag OFF | `[]` always (or omit population) | Same as today |
| Flag ON, 0 visits | `[]` | `null` |
| Flag ON, 1 visit | `[v1]` | `v1` |
| Flag ON, N visits | `[v1..vN]` | Primary per §6.3 |

### 6.3 Primary visit selection algorithm

When flag ON and `upcomingVisits.length > 1`:

1. Sort by `scheduledAt` ascending.
2. Prefer status `confirmed` over `scheduled` if same day and within 4 hours.
3. Set `activeVisit = upcomingVisits[0]` after sort (document exact comparator in code comment).
4. **Do not** auto-cancel or merge visits — read-only aggregation.

---

## 7. Prompt block changes (flag ON only)

Add to `buildPromptBlock` when `upcomingVisits.length > 1`:

```markdown
### Upcoming Site Visits (2)

1. **Sunset Heights 1102** — ✅ CONFIRMED — Saturday 14 June, 4:00 PM
2. **Lake Vista 304** — 📅 SCHEDULED — Saturday 14 June, 6:00 PM

⚠️ RULE: Customer has MULTIPLE upcoming visits. When they say "confirm", "cancel", or "reschedule"
without naming a property, you MUST ask which visit they mean. List options by property name and time.
Do NOT assume the first visit only.
```

When `upcomingVisits.length === 1`, prompt block matches legacy single-visit format (parity).

---

## 8. Algorithm — visit query window

**Current:** 2-hour grace past `scheduledAt` for `.find()`.

**Keep** same window for inclusion in `upcomingVisits`:

```typescript
const VISIT_INCLUDE_STATUSES = ['scheduled', 'confirmed', 'rescheduled'] as const;
const GRACE_MS = 2 * 60 * 60 * 1000;

function isUpcomingVisit(v: Visit, now: Date): boolean {
  return VISIT_INCLUDE_STATUSES.includes(v.status as typeof VISIT_INCLUDE_STATUSES[number])
    && new Date(v.scheduledAt).getTime() >= now.getTime() - GRACE_MS;
}
```

**Future visits cap:** Max **5** in `upcomingVisits` (align with prisma `take`). Log warn if truncated.

---

## 9. What to REMOVE

| Remove / avoid | Reason |
|----------------|--------|
| Changing `activeVisit` to null when multiple exist | Breaks enterprise v2 button catch-all |
| Removing single-visit prompt rules | Regression for 1-visit tenants |
| Editing visit mutation logic | Chunk 05 |

---

## 10. What to ADD

| Addition | Location |
|----------|----------|
| `upcomingVisits: ActiveVisitContext[]` on return type | `liveLeadContext.service.ts` |
| `selectPrimaryVisit(visits: ActiveVisitContext[]): ActiveVisitContext \| null` | Same file, exported for Chunk 05 |
| Multi-visit prompt section | `buildPromptBlock` |
| Feature flag gate | `config/index.ts` |
| Unit tests: 0, 1, 2, 3 visits | `liveLeadContext.service.test.ts` |

---

## 11. Implementation steps (ordered)

1. Add flag to `config/index.ts` (default OFF).
2. Extend `LiveLeadContext` interface + `buildEmptyContext()` with `upcomingVisits: []`.
3. Refactor visit loop: when flag OFF, keep exact `.find()` behavior; when ON, `.filter()` + sort.
4. Implement `selectPrimaryVisit` — verify `activeVisit` equals legacy `.find()` for all existing unit scenarios.
5. Extend `buildPromptBlock` behind flag for N>1.
6. Write unit tests (§14).
7. Run smoke — confirm single-visit tenants unchanged with flag OFF.

---

## 12. Why it won't break in future

| Risk | Mitigation |
|------|------------|
| Callers assume one visit | `activeVisit` preserved; `upcomingVisits` additive |
| Prompt token bloat | Cap at 5 visits; summarize older in one line |
| Primary visit wrong | Exported `selectPrimaryVisit` + tests; Chunk 05 owns disambiguation UX |
| Flag forgotten ON in prod | Chunk 10 rollout checklist; default OFF until sign-off |

**Single source of truth:** All visit lists for AI prompt come from `getLiveLeadContext` — Chunk 05 must not duplicate prisma visit queries for buyer-facing disambiguation (import registry helpers instead).

---

## 13. Debug instrumentation

| Hook | When |
|------|------|
| `logger.info('liveLeadContext.multiVisit', { leadId, count: upcomingVisits.length })` | Flag ON and count > 1 |
| `FEATURE_SHADOW_MODE` compare | Log if legacy `.find()` id !== `selectPrimaryVisit` id |

---

## 14. Verification checklist

### Unit tests

```bash
cd backend
npm test -- --testPathPattern="liveLeadContext|buyerEnterpriseUx"
```

| Test case | Expected |
|-----------|----------|
| Flag OFF, 2 visits in DB | `activeVisit` = legacy first only; `upcomingVisits` = `[]` |
| Flag ON, 0 visits | `activeVisit` null; `upcomingVisits` [] |
| Flag ON, 1 confirmed visit | Both arrays length 1; same id |
| Flag ON, 2 same-day visits | `upcomingVisits.length === 2`; prompt contains both names |
| Flag ON, pending_approval + scheduled | pending becomes `activeVisit` (legacy rule preserved) |
| Primary visit tie-break | confirmed beats scheduled same day |

### Smoke / manual

1. Lead with one visit → greeting unchanged (flag ON).
2. Lead with two future visits → AI prompt block lists both (inspect logs / shadow mode).

### Regression

- `buyerEnterpriseUx.service.test.ts` button matrix still passes (uses single `activeVisit` mock).

---

## 15. Definition of Done

- [ ] Flag `FEATURE_MULTI_VISIT_CONTEXT` added, default OFF
- [ ] `upcomingVisits` populated when flag ON
- [ ] `activeVisit` backward compatible
- [ ] Multi-visit prompt block when N > 1
- [ ] Unit tests green
- [ ] No edits outside IN SCOPE files
- [ ] `npm run smoke` passes with flag OFF

---

## 16. Rollback

Set `FEATURE_MULTI_VISIT_CONTEXT=false` on Railway — no migration. Revert PR if type changes break compile.

---

## 17. Next chunk

After Done → [chunk-02.md](./chunk-02.md) (Conversation focus stack — project + property memory).
