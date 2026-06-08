# Chunk 07 — H9 Full AI Brain + Policy FSM + Objections (PART III, VIII, XI)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | 07 | full.md **PART III** H9 + **PART VIII** + **PART XI** |

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `whatsappTurnOrchestrator.service.ts` | `handleFullAiTurn` only |
| `conversationStateMachine.ts` | Policy brain, `classifyMessageIntent`, `OBJECTION_PLAYBOOKS`, stage transitions |
| `ai.service.ts` | `generateResponse` buyer path — provider chain, 28s timeout, `ai_replies` counter |
| `neverSayNoEngine.service.ts` | Context block for empty inventory |
| `leadScoring.service.ts` | `syncLeadScoreFromConversation` |
| `messagePolish.service.ts` | **Read** — polish called from H9 path only if already wired |
| `tests/unit/conversationStateMachine.test.ts`, `ai.service.test.ts` | extend |

---

## 3. H9 algorithm (full.md §III.H9)

```
1. IF callCommit.committed → replay H-call first
2. Load lead, neverSayNoCtx, properties (RAG enrich), conversationContextBlock
3. Promise.race generateResponse vs 28s timeout → fallback text
4. policyBrain.processMessage → nextAction (advance_stage, handle_objection, escalate, …)
5. applyVisitMutationFromChat SAFETY NET overrides wrong LLM visit text
6. extractAndPatchLeadMemory + syncLeadClientMemory async
7. transitionLeadStatus new→contacted on first AI reply
8. resolveBuyerComponents from newState
9. enforceTurnComponentBudget (1 interactive OR 1 media)
10. Escalation: notifyBuyerAgentAssistNeeded — DO NOT set agent_active
```

---

## 4. Escalation vs takeover (critical)

| Event | conversation.status | aiEnabled |
|-------|---------------------|-----------|
| escalate_to_human workflow | **ai_active** | true |
| Price negotiation intent | **ai_active** | true |
| Dashboard takeover | agent_active | false → H1 |

**REMOVE** any code in H9 that sets `agent_active` on escalation.

---

## 5. Objection playbooks (PART VIII)

Wire `OBJECTION_PLAYBOOKS` into prompt modifiers when `nextAction.action === 'handle_objection'`. Copy must match full.md tables verbatim (empathy, reframe, bridge, fallback).

---

## 6. Stage regression guard

`isAllowedStageTransition`: block `visit_booking|confirmation|commitment` → `rapport|qualify|shortlist` unless explicit pivot phrases.

---

## 7. If it breaks

| Symptom | Cause |
|---------|-------|
| All messages → H9 only | Earlier handlers broken (prior chunks) |
| LLM invents prices | groundingGuard / property context missing |
| Escalation silences AI | Wrong status flip |
| 28s hang | timeout fallback missing |

---

## 8. Verification

E2E: `buyer-11-escalate`, `buyer-12-no-discount`, `buyer-04-price` (H7 preferred but H9 fallback)

---

## Next: [chunk-08.md](./chunk-08.md)
