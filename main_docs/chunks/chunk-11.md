# Chunk 11 — Outbound Pipeline (PART XII)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | 11 | full.md **PART XII** Outbound Pipeline |

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `whatsapp.service.ts` | `sendTurnResult`, `beginOutboundTurn`, `claimPrimaryOutboundSend`, `claimOutboundAiReply` blocks only |
| `messagePolish.service.ts` | `polishOutboundMessage` — **3s timeout** fail-open to raw text |
| `whatsappResponseSanitizer.service.ts` | `sanitizeBuyerOutbound`, `stripBuyerInternalMetadata` |
| `mutationLanguageGuard.service.ts` | Post-LLM visit language override hook |
| `outboundTurnDebug.service.ts` | `logOutboundBranch` codes |
| `metaMessageBuilder.service.ts` | Interactive payload limits |
| `providers/meta-whatsapp.provider.ts` | Circuit breaker + withRetry on send |
| `tests/unit/outbound*.test.ts`, `messagePolish.test.ts` | extend |

---

## 3. Message status algorithm (PART XII + hardening plan 1-A)

```
1. prisma.message.create({ status: 'pending' })
2. send via Meta API (withRetry + circuit breaker)
3. IF success → update status: 'sent'
4. IF fail → update status: 'failed' + optional agent notification
5. Stuck pending >5min → sweep job retry once (if job exists in automation)
```

---

## 4. One-outbound-per-turn

```
beginOutboundTurn(inboundMessageId)
claimPrimaryOutboundSend → only first text/interactive sends
enforceTurnComponentBudget: buttons OR list wins over separate media
simulateHumanReplyPacing: typing indicator delay
```

---

## 5. Sanitize pipeline order

```
neverSayNo injection check → strip internal IDs/scores → polish (3s) → mutationLanguageGuard → banned phrases → safe fallback
```

---

## 6. REMOVE

- Creating messages with `status: 'sent'` before API returns
- Multiple primary bubbles per inbound messageId
- Debug fetch 127.0.0.1

---

## 7. If it breaks

| Symptom | Cause |
|---------|-------|
| CRM shows sent, customer got nothing | pending not updated on fail |
| Double WhatsApp bubbles | primary send claim bypass |
| Slow every reply | polish blocking >3s without timeout |

---

## 8. Verification

E2E all scenarios; unit `outbound-fix-proof.test.ts`

---

## Next: [chunk-12.md](./chunk-12.md)
