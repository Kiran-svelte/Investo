# Chunk 02 — Conversation Focus Stack (Project + Property Memory)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Field | Value |
|-------|-------|
| Chunk | 02 of 10 |
| Workstream | Enterprise Multi-Project Buyer UX |
| Status | **Done** |
| Est. PR size | ~450–650 LOC across 6 files |
| Feature flag | `FEATURE_BUYER_FOCUS_STACK` (default **OFF**) |
| Depends on | Chunk 01 optional (no hard dependency) |
| Blocks | Chunks 03, 04, 06, 09 |

---

## 1. Objective

Introduce a **first-class focus model** for buyer conversations so the system tracks:

- Which **project** the buyer is browsing (`focusedProjectId`)
- Which **property** is currently discussed (`focusedPropertyId`)
- Which **list** was last shown (`recommendedPropertyIds` — already exists on Conversation)
- Explicit **project switch** detection ("actually I meant Lake Vista")

**Why:** Today `selectedProjectId` is written only into `commitments` JSON during interactive project browse (`whatsappInteractiveOrchestrator.service.ts` lines 672, 751) but is **never read** by AI turns or visit booking. `selectedPropertyId` is a single slot that gets overwritten when the buyer switches projects.

Spec reference: bugfix.md rows **2.7–2.9** (`interested_project`, session memory).

**Do NOT** in this chunk: change property resolution algorithms (Chunk 03), AI catalog loading (Chunk 04), or interactive handlers (Chunk 09).

---

## 2. Files IN SCOPE (exclusive edit list)

| File | What you may change |
|------|---------------------|
| `backend/src/services/buyer/buyerConversationFocus.service.ts` | **NEW** — focus types, read/write, switch detection |
| `backend/src/types/whatsapp-turn.types.ts` | Add `BuyerConversationFocus` to turn context input |
| `backend/src/services/whatsapp/whatsappTurnOrchestrator.service.ts` | **Only** load/persist focus at turn start/end (orchestrate entry + state patch helpers) |
| `backend/src/services/whatsapp.service.ts` | **Only** pass focus fields into `orchestrateWhatsAppBuyerTurn` context builder |
| `backend/src/tests/unit/buyerConversationFocus.service.test.ts` | **NEW** |
| `backend/src/config/index.ts` | Add `buyerFocusStack` flag |

---

## 3. Files READ-ONLY

| File | Why |
|------|-----|
| `backend/src/services/buyerPropertyContext.service.ts` | Chunk 03 consumes focus |
| `backend/src/services/whatsapp/whatsappInteractiveOrchestrator.service.ts` | Chunk 09 wires interactive → focus |
| `backend/prisma/schema.prisma` | **No migration in this chunk** — use `commitments` JSON |

---

## 4. Data model (no Prisma migration)

Store in `conversation.commitments` under stable keys:

```typescript
export type BuyerFocusCommitments = {
  /** Project board UUID — set when buyer selects project or property in project */
  focusedProjectId?: string | null;
  /** ISO timestamp of last focus change */
  focusUpdatedAt?: string;
  /** Previous focusedPropertyId — for switch detection */
  previousFocusedPropertyId?: string | null;
  /** Mirror of conversation.selectedPropertyId for audit; canonical column still selectedPropertyId */
};
```

**Canonical columns (unchanged):**

- `conversation.selectedPropertyId` → maps to `focusedPropertyId` when flag ON
- `conversation.recommendedPropertyIds` → ordered list from last outbound list

**Why commitments + columns:** Columns are indexed and already used by visit booking; commitments hold project id without migration. Chunk 10 may add `selectedProjectId` column if query volume warrants it.

---

## 5. Core API (`buyerConversationFocus.service.ts`)

### 5.1 Read

```typescript
export function readBuyerConversationFocus(conversation: {
  selectedPropertyId: string | null;
  recommendedPropertyIds: unknown;
  commitments: unknown;
}): BuyerConversationFocus;
```

Returns:

```typescript
export type BuyerConversationFocus = {
  focusedProjectId: string | null;
  focusedPropertyId: string | null;
  recommendedPropertyIds: string[];
  /** Property IDs allowed for buttons + validators (Chunks 06–07) */
  allowedPropertyIds: string[];
};
```

**`allowedPropertyIds` algorithm:**

1. If `focusedPropertyId` → include it.
2. Union `recommendedPropertyIds` (max 10).
3. If `focusedProjectId` and list empty → **do not** load all project properties here (Chunk 04 owns catalog); leave list as `[focusedPropertyId]` only.
4. Deduplicate, preserve order (focused first).

### 5.2 Write

```typescript
export function patchBuyerConversationFocus(
  current: BuyerConversationFocus,
  patch: Partial<{
    focusedProjectId: string | null;
    focusedPropertyId: string | null;
    recommendedPropertyIds: string[];
  }>,
): { focus: BuyerConversationFocus; commitmentsPatch: BuyerFocusCommitments; columnPatch: {
  selectedPropertyId?: string | null;
  recommendedPropertyIds?: string[];
}};
```

### 5.3 Switch detection

```typescript
export function detectProjectOrPropertySwitch(input: {
  messageText: string;
  current: BuyerConversationFocus;
  resolvedPropertyId: string | null;
  resolvedProjectId: string | null;
}): 'none' | 'property_switch' | 'project_switch' | 'ambiguous';
```

**Heuristics:**

- New property name in message ≠ current `focusedPropertyId` → `property_switch`
- New project browse tap (caller sets project id) → `project_switch`
- Message matches property in different project than `focusedProjectId` → `project_switch`
- Explicit phrase: "other project", "different one", "not that one" → `ambiguous` (trigger clarify in Chunk 03)

When flag OFF: `readBuyerConversationFocus` returns legacy shape (`focusedPropertyId = selectedPropertyId`, `focusedProjectId = null`, `allowedPropertyIds` from recommended + selected only).

---

## 6. Orchestrator integration (minimal)

In `orchestrateWhatsAppBuyerTurn` (entry only):

1. **Load:** `const focus = readBuyerConversationFocus(conversation)` when flag ON.
2. **Attach** to `BuyerTurnRuntimeContext.input`:
   - `conversationFocus: focus`
   - Keep existing `conversationSelectedPropertyId` for backward compat (= `focus.focusedPropertyId` when flag ON).
3. **Persist:** When turn returns `newState` with property/project updates, merge via `patchBuyerConversationFocus` before prisma update.

**Do not** refactor H2–H9 handlers in this chunk — only thread focus through context object.

---

## 7. Connection diagram

```
handleIncomingMessage
  └── orchestrateWhatsAppBuyerTurn(ctx)
        ├── readBuyerConversationFocus(conversation)     [NEW]
        ├── ctx.input.conversationFocus = focus          [NEW]
        ├── … existing handlers …
        └── persistTurnState(newState)
              └── patchBuyerConversationFocus → commitments + columns
```

Chunk 09 will call `patchBuyerConversationFocus` from interactive handlers when flag ON.

---

## 8. Mapping to existing fields

| Legacy field | Focus field | Notes |
|--------------|-------------|-------|
| `selectedPropertyId` | `focusedPropertyId` | Same UUID |
| `recommendedPropertyIds` | `recommendedPropertyIds` | Same array |
| `commitments.selectedProjectId` | `focusedProjectId` | Read legacy key if present |
| — | `allowedPropertyIds` | Derived; used in Chunks 06–07 |

---

## 9. What to REMOVE

| Remove | Reason |
|--------|--------|
| Scattered `commitments.selectedProjectId` writes without read path | Replaced by focus service (Chunk 09 consolidates writes) |
| Duplicated "set selectedPropertyId" in orchestrator | Single `patchBuyerConversationFocus` |

**Do not remove** existing `selectedPropertyId` column usage — wrap, don't replace, until flag ON.

---

## 10. What to ADD

| Addition | Location |
|----------|----------|
| `buyerConversationFocus.service.ts` | New module |
| `conversationFocus` on turn context type | `whatsapp-turn.types.ts` |
| Load/persist hooks | `whatsappTurnOrchestrator.service.ts` (≤80 LOC) |
| Context pass-through | `whatsapp.service.ts` (≤30 LOC) |
| Unit tests | `buyerConversationFocus.service.test.ts` |

---

## 11. Implementation steps (ordered)

1. Add flag `FEATURE_BUYER_FOCUS_STACK`.
2. Implement `readBuyerConversationFocus` with flag OFF legacy path.
3. Implement `patchBuyerConversationFocus` + `detectProjectOrPropertySwitch`.
4. Extend `BuyerTurnRuntimeContext` / input types.
5. Wire load at orchestrator entry; wire persist on `newState` merge (same place `selectedPropertyId` is saved today).
6. Unit tests for read/write/switch detection.
7. Smoke with flag OFF — zero behavior change.

---

## 12. Why it won't break in future

| Risk | Mitigation |
|------|------------|
| Stale project id in commitments | `focusUpdatedAt` + switch detection clears on project change |
| Double source of truth | Columns remain canonical for property id; commitments for project only |
| Orchestrator bloat | Logic in dedicated service; orchestrator only loads/saves |
| Interactive not wired yet | Flag OFF until Chunk 09; read path honors legacy `selectedProjectId` in commitments from old code |

**Contract for downstream chunks:**

- Chunk 03: pass `focus.focusedProjectId` into `resolveBuyerPropertyReference`
- Chunk 04: pass `focus.allowedPropertyIds` as catalog seed
- Chunk 06: validate buttons ⊆ `allowedPropertyIds`
- Chunk 07: validate LLM mentions ⊆ `allowedPropertyIds` (+ visit property ids from Chunk 01)

---

## 13. Debug instrumentation

```typescript
logger.info('buyerFocus.updated', {
  conversationId,
  focusedProjectId,
  focusedPropertyId,
  allowedCount: allowedPropertyIds.length,
  switch: detectResult,
});
```

Shadow mode: log when legacy `selectedPropertyId` !== patched `focusedPropertyId` after turn.

---

## 14. Verification checklist

```bash
npm test -- --testPathPattern="buyerConversationFocus"
npm test -- --testPathPattern="whatsappTurnOrchestrator"
```

| Test case | Expected |
|-----------|----------|
| Flag OFF | `focusedProjectId` always null; property from column only |
| Read with commitments.selectedProjectId | Returns project id |
| Patch property id | Updates column + commitments timestamp |
| Switch detection: new property name | `property_switch` |
| allowedPropertyIds | focused + recommended, deduped, max 10 |
| Orchestrator persists focus on newState | Integration test mock prisma update |

---

## 15. Definition of Done

- [ ] Focus service created with read/write/switch API
- [ ] Turn context carries `conversationFocus` when flag ON
- [ ] Persist path updates commitments + columns atomically
- [ ] Flag OFF = byte-for-byte legacy behavior
- [ ] Unit tests green
- [ ] No edits outside IN SCOPE

---

## 16. Rollback

`FEATURE_BUYER_FOCUS_STACK=false`. Commitments keys are inert; columns unchanged.

---

## 17. Next chunk

After Done → [chunk-03.md](./chunk-03.md) (Project-scoped property resolution).
