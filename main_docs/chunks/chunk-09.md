# Chunk 09 — Interactive Orchestrator Multi-Project Hardening

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Field | Value |
|-------|-------|
| Chunk | 09 of 10 |
| Workstream | Enterprise Multi-Project Buyer UX |
| Status | **Done** |
| Est. PR size | ~550–800 LOC across 4 files |
| Feature flag | Uses Chunks 01–08 flags (no separate flag — gated by `FEATURE_BUYER_FOCUS_STACK` master) |
| Depends on | Chunks 01–08 |
| Blocks | Chunk 10 |

---

## 1. Objective

Wire **all interactive buyer handlers** to the focus stack, scoped resolution, button validator, and second-visit policy — eliminating the split where `selectedProjectId` is written to commitments but never read on subsequent turns.

**Primary file:** `whatsappInteractiveOrchestrator.service.ts` (~1200 lines) — handlers for project browse, property list, more-info, book-visit, filters.

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `backend/src/services/whatsapp/whatsappInteractiveOrchestrator.service.ts` | All buyer interactive handlers listed in §3 |
| `backend/src/services/whatsapp/whatsappInteractivePersist.service.ts` | Persist focus patch on `newState` |
| `backend/src/tests/unit/whatsappInteractiveOrchestrator.test.ts` | Multi-project scenarios |
| `backend/src/tests/unit/buyerCopyCompliance.test.ts` | Verify new i18n only via tBuyer |

---

## 3. Handlers to update (checklist)

| Handler | Function | Required changes |
|---------|----------|------------------|
| Project select | `handleProjectSelect` | `patchBuyerConversationFocus({ focusedProjectId, recommendedPropertyIds: top 5 unit ids })` |
| Project properties list | `handleProjectProperties` | Set focus project + clear focused property until unit tap |
| Property from list | `handlePropertyListReply` / property tap ids | Set `focusedPropertyId` |
| More info | `handleMoreInfo` | Use focus allowed set; second-visit policy on buttons; booked property reminder unchanged |
| Book visit | `handleBookVisit` | `evaluateSecondVisitPolicy`; scoped property id from button suffix |
| Book visit time slot | `handleVisitTimeSlot` | Resolve property via scoped resolver |
| Property filter | `handlePropertyFilter` | Update `recommendedPropertyIds` from filter results; project scope if filter is project-specific |
| Browse projects | `browse-projects` id | Clear focused property; keep project null until selection |
| Discovery list | `handleDiscoveryList` | Set recommended ids from snapshot |

**Do NOT** change staff approval handlers, agent copilot interactive paths, or visit-approve/decline.

---

## 4. Focus persist pattern

Every handler returning `newState` must use `mergeInteractiveNewState` in `whatsappInteractivePersist.service.ts` — orchestrator returns extended `newState`; `applyInteractiveActionSideEffects` persists focus patch.

---

## 5. Verification checklist

```bash
npm test -- --testPathPattern="whatsappInteractiveOrchestrator|buyerCopyCompliance"
npm run smoke
```

---

## Next: [chunk-10.md](./chunk-10.md)
