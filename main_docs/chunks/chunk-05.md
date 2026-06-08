# Chunk 05 — Memory, Qualification, Visit Query (H3, H4, H5)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | 05 | full.md **PART III** §III.H3, H4, H5 |

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `whatsappTurnOrchestrator.service.ts` | `handleMemoryRecallTurn`, `handleQualificationTurn`, `handleVisitStatusTurn` |
| `buyerQualification.service.ts` | `isBuyerQualificationStatement`, `buildBuyerQualificationAckReply`, memory recall helpers |
| `buyerVisitQuery.service.ts` | `isBuyerVisitStatusQuery`, `buildBuyerVisitStatusReply` |
| `lead-memory.service.ts` | `patchLeadMemory`, `getLeadMemory` — **only** functions called by H3/H4 |
| `tests/unit/buyerVisitQuery.test.ts`, `buyerQualification*.test.ts` | extend |

---

## 3. H4 Qualification algorithm

```
IF EXPLICIT_INTENT in message → skip (falls to H7/H9)
IF question form about saved prefs → H3 not H4
IF isBuyerQualificationStatement → extract delta → patchLeadMemory → buildBuyerQualificationAckReply
async syncLeadClientMemory (fire-and-forget)
```

---

## 4. H5 Visit status algorithm

```
IF isBuyerVisitStatusQuery → buildBuyerVisitStatusReply(liveCtx)
May set stage → confirmation if active confirmed visit
Buttons via resolveBuyerComponents with hasActiveVisit
```

**Intent guard in FSM:** visit status queries must be `adjacent` not `escalation_request` (Chunk 07 cross-check only).

---

## 5. REMOVE

- LLM calls inside H4/H5 paths
- Duplicate visit status text in H9 when H5 should have caught it

---

## 6. Verification

E2E: `buyer-02-qualify`, visit status query manual script

---

## Next: [chunk-06.md](./chunk-06.md)
