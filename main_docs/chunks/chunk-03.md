# Chunk 03 — Orchestrator Shell + H-start, H1, H0, H1b (full.md PART III)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | 03 | full.md **PART III** §III.H-start, H1, H0, H1b + cascade shell |
| Status | **Done** |

---

## 1. Objective

Extract **`orchestrateWhatsAppBuyerTurn`** cascade order as immutable contract. Implement/refactor only terminal handlers **H-start, H1, H0, H1b**. Remove any alternate entry paths that bypass this order.

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `backend/src/services/whatsapp/whatsappTurnOrchestrator.service.ts` | `orchestrateWhatsAppBuyerTurn`, `handleStartFreshTurn`, `handleHumanTakeoverTurn`, `handleInteractiveSafetyTurn`, `handleDismissalTurn`, `isHumanTakeoverActive` |
| `backend/src/tests/unit/whatsappTurnOrchestrator.handlers.test.ts` | **CREATE** — H-start/H1/H1b cases |

**Do not edit** H2–H9 function bodies in this chunk (leave as-is).

---

## 3. Cascade order (hard-code + test)

```text
H-start → H1 → H0 → [visitCommit external] → H1b → H2 → … → H9
```

Add unit test asserting **H1 runs before H0** and **H-start before H1**.

---

## 4. H-start (full.md §III.H-start)

| Item | Spec |
|------|------|
| Precondition | `isBuyerStartCommand` → `/start` |
| DB | `resetBuyerBookingAndConversationState` |
| Client | `buildBuyerStartFreshReply(companyName)` |
| Buttons | none |
| Log | `logOutboundBranch('H-start', ...)` |

---

## 5. H1 Human takeover (full.md §III.H1)

| Item | Spec |
|------|------|
| Precondition | `humanTakeover` = `status==='agent_active' && !aiEnabled` |
| **NOT** escalation | Do not set takeover on `escalatedAt` alone |
| Dedup | `isLastAiMessageAlreadyHandoff` — no spam |
| Agent notify | assigned agent WhatsApp + in-app; else all admins |
| Client template | Handoff + `operatorContact` from ai_settings |

---

## 6. H0 Interactive safety (full.md §III.H0)

Runs when `interactiveId` present but upstream `handleInteractiveAction` missed (edge case).

Calls `tryOrchestratedInteractiveAction` → `applyInteractiveActionSideEffects` → `persistInteractiveAiTranscript`.

Fallback: `buildSafeBuyerFallback()`.

---

## 7. H1b Dismissal (full.md §III.H1b)

| Item | Spec |
|------|------|
| Regex | `DISMISSAL_RE` (no thanks, ok, thanks, got it, …) |
| Requires | `hasPriorOutbound` from Chunk 02 util |
| Skip if | `visitCommit.committed` |

---

## 8. Connection

```
whatsapp.service.ts
  └── orchestrateWhatsAppBuyerTurn(ctx, conversationState)
        ├── handleStartFreshTurn
        ├── handleHumanTakeoverTurn
        ├── handleInteractiveSafetyTurn
        └── handleDismissalTurn (after visitCommit injected in later chunk — pass null stub if needed)
```

---

## 9. REMOVE

- Logic that routes to H1 on escalation flags
- Duplicate handoff message creates without dedup check

---

## 10. Verification

```bash
npm test -- --testPathPattern="whatsappTurnOrchestrator.handlers"
```

E2E: `system-takeover-blocks-ai`, `system-takeover-release` (after deploy).

---

## Next: [chunk-04.md](./chunk-04.md)
