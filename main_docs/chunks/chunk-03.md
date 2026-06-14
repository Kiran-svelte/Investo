# Chunk 03 — Project-Scoped Property Reference Resolution

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Field | Value |
|-------|-------|
| Chunk | 03 of 10 |
| Workstream | Enterprise Multi-Project Buyer UX |
| Status | **Done** |
| Est. PR size | ~400–550 LOC across 5 files |
| Feature flag | `FEATURE_SCOPED_PROPERTY_RESOLVE` (default **OFF**) |
| Depends on | Chunk 02 (`BuyerConversationFocus`) |
| Blocks | Chunks 04, 05, 08, 09 |

---

## 1. Objective

Harden `resolveBuyerPropertyReference` and `resolveBuyerPropertyReferenceEnterprise` so property name matching **respects project scope** and **detects cross-project ambiguity** before falling back to stale `selectedPropertyId`.

**Why:** `findPropertyMentionedByName` loads up to 100 properties company-wide and returns first substring match:

```44:63:backend/src/services/buyerPropertyContext.service.ts
async function findPropertyMentionedByName(
  companyId: string,
  messageText: string,
  statuses: PropertyStatus[] = ['available', 'upcoming'],
): Promise<string | null> {
  const properties = await prisma.property.findMany({
    where: { companyId, status: { in: statuses } },
    select: { id: true, name: true },
    take: 100,
  });
  // ... first match wins
}
```

With 5 projects × 20 units, "1102" or "Heights" can match the wrong project. Stale `selectedPropertyId` from Project A then books Project B (code already warns via `hasExplicitPropertyNameIntent` but doesn't scope by project).

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `backend/src/services/buyerPropertyContext.service.ts` | Scoped search, ambiguity result type, enterprise resolver |
| `backend/src/services/customerVisitBooking.service.ts` | Pass focus/project into `resolvePropertyId` |
| `backend/src/services/whatsapp/whatsappTurnOrchestrator.service.ts` | **Only** H6–H8 + H9 calls to `resolveBuyerPropertyReference*` — pass `scopedProjectId`, handle ambiguous |
| `backend/src/tests/unit/buyerPropertyContext.service.test.ts` | Extend multi-project cases |
| `backend/src/config/index.ts` | `scopedPropertyResolve` flag |

---

## 3. Files READ-ONLY

| File | Why |
|------|-----|
| `backend/src/services/buyer/buyerConversationFocus.service.ts` | Chunk 02 — import only |
| `backend/src/utils/propertyBrowseTurn.util.ts` | Uses enterprise resolver — may need read for test updates only |

---

## 4. API changes

### 4.1 Extended input

```typescript
export type BuyerPropertyResolveInput = {
  companyId: string;
  messageText: string;
  selectedPropertyId?: string | null;
  recommendedPropertyIds?: readonly string[] | null;
  /** Chunk 02 — when set, name search prefers properties in this project */
  scopedProjectId?: string | null;
  /** When true, return ambiguity instead of first match */
  strictMultiMatch?: boolean;
};
```

### 4.2 Extended result (flag ON)

```typescript
export type BuyerPropertyResolveResult = {
  propertyId: string | null;
  /** Multiple name matches across projects — caller must clarify */
  ambiguousMatches?: Array<{ id: string; name: string; projectId: string | null }>;
  /** Match found but in different project than scopedProjectId */
  crossProjectSwitch?: boolean;
};
```

When flag OFF: functions return `string | null` / existing enterprise shape (no breaking change).

### 4.3 Resolution algorithm (flag ON)

```
1. If scopedProjectId set:
     a. Search properties WHERE companyId AND projectId = scopedProjectId AND status IN (available, upcoming)
     b. Name match within project first
2. If no match AND message has explicit property intent:
     c. Search company-wide (take 100)
     d. If multiple matches with different projectIds → return ambiguousMatches (do NOT pick first)
3. If single company-wide match AND scopedProjectId set AND project differs:
     → crossProjectSwitch = true; return that propertyId (Chunk 08 may intercept for second visit)
4. Ordinal reference against recommendedPropertyIds (unchanged)
5. Fallback selectedPropertyId ONLY if:
     - NOT hasExplicitPropertyNameIntent
     - NOT crossProjectSwitch without confirmation
6. recommended.length === 1 fallback (unchanged)
7. else null
```

---

## 5. Ambiguity UX contract (orchestrator only)

When `ambiguousMatches?.length > 1`, orchestrator **must not** call visit commit or H9 with a guessed property.

Return deterministic clarify turn (i18n keys to add in Chunk 09 or here if keys in `buyerI18n.util.ts` — **if adding keys, only add to `buyerI18n.util.ts` and list in PR**):

```
I found more than one match:
1. Sunset Heights 1102
2. Lake Heights 1102
Which one do you mean? Reply with the number or full name.
```

Store `ambiguousMatches` ids in `recommendedPropertyIds` for ordinal follow-up.

**Handler:** Short-circuit in `handleClassifierWorkflowTurn` / visit commit path before DB write.

---

## 6. Connection diagram

```
resolveBuyerPropertyReferenceEnterprise(input)
  │
  ├─ findSoldPropertyMentionedByName (unchanged)
  │
  └─ resolveBuyerPropertyReference(input)
        ├─ findPropertyMentionedByNameScoped(projectId?)
        ├─ findPropertyMentionedByNameGlobal → ambiguity check
        ├─ resolveOrdinalReference
        └─ selectedPropertyId fallback (guarded)

customerVisitBooking.resolvePropertyId
  └── passes scopedProjectId from conversationFocus

handleFullAiTurn
  └── resolvedPropertyId from enterprise resolver
        └── if ambiguous → clarify turn (skip LLM)
```

---

## 7. Sold property path (unchanged behavior)

`findSoldPropertyMentionedByName` stays company-wide — sold unit by name must still explain + project listings button (enterprise invariant #5).

Optional flag ON improvement: include `projectName` in sold explanation when multiple "1102" exist.

---

## 8. What to REMOVE

| Remove | Reason |
|--------|--------|
| Blind fallback to `selectedPropertyId` when `crossProjectSwitch` without explicit confirm | Wrong-property booking |
| Silent first-match on multi-match global search | Ambiguity clarify instead |

---

## 9. What to ADD

| Addition | Location |
|----------|----------|
| `findPropertyMentionedByNameScoped` | `buyerPropertyContext.service.ts` |
| `resolveBuyerPropertyReferenceWithMeta` | Same (internal); public API gated by flag |
| Ambiguity short-circuit | `whatsappTurnOrchestrator.service.ts` (≤60 LOC) |
| Visit booking scope pass-through | `customerVisitBooking.service.ts` (≤20 LOC) |
| Tests: same unit number two projects, scoped match, ambiguous | `buyerPropertyContext.service.test.ts` |

---

## 10. Implementation steps

1. Add flag.
2. Implement scoped name search with projectId filter on Property model (`projectId` column exists).
3. Implement ambiguity detection (≥2 matches, different projectIds OR same token "1102").
4. Extend enterprise resolver to return meta when flag ON; wrap legacy return when OFF.
5. Wire orchestrator clarify turn.
6. Wire visit booking `resolvePropertyId`.
7. Tests + smoke.

---

## 11. Why it won't break in future

| Risk | Mitigation |
|------|------------|
| Single-project tenant | Scoped search with null projectId = global (legacy) |
| Performance | Project-scoped query smaller than 100-row scan |
| Breaking callers | Flag OFF preserves `Promise<string \| null>` paths |
| Wrong clarify loop | Cap ambiguous list at 5; ordinal "1"/"2" resolves next turn |

**Downstream mapping:**

- Chunk 04 uses resolved `propertyId` as focused catalog anchor
- Chunk 05 uses resolved property for visit target when booking
- Chunk 08 uses `crossProjectSwitch` for second-visit policy

---

## 12. Verification checklist

```bash
npm test -- --testPathPattern="buyerPropertyContext|customerVisitBooking"
```

| Test case | Expected |
|-----------|----------|
| Flag OFF | Identical to existing test suite |
| Scoped project, name unique in project | Returns that id |
| "1102" matches 2 projects | `ambiguousMatches.length === 2`, propertyId null |
| Explicit "Lake Vista 304" | Resolves even if selectedPropertyId is Sunset |
| hasExplicitPropertyNameIntent + no match | null (no stale fallback) |
| Visit booking with scope | Books property in focused project |

Manual: Multi-project tenant — message unit number shared across projects → clarify list, not wrong booking.

---

## 13. Definition of Done

- [x] Scoped + ambiguous resolution behind flag
- [x] Orchestrator clarify path for ambiguity
- [x] Visit booking passes project scope
- [x] All existing buyerPropertyContext tests pass (flag OFF)
- [x] New multi-project tests pass (flag ON)

---

## 14. Rollback

`FEATURE_SCOPED_PROPERTY_RESOLVE=false`.

---

## 15. Next chunk

After Done → [chunk-04.md](./chunk-04.md) (Scoped AI property catalog).
