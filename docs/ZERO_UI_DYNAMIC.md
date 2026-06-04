# Zero UI — dynamic WhatsApp actions

Investo does **not** rely on a fixed list of trained phrases. Every inbound message is handled in layers:

## Layer 1 — CRM mutations (deterministic, always first for buyers)

`tryCommitCustomerVisitBooking` runs **before** the prospect LLM.

- **Cancel / reschedule** → `applyVisitMutationFromChat` updates the visit in Postgres and returns the real new slot.
- **Book / confirm** → schedules visit when a parseable date/time exists.
- Parses the **target** slot after “reschedule to …” so “tomorrow” in the cancel clause does not override “this Saturday 1pm”.

## Layer 2 — Staff agent copilot (tools + deterministic)

- `tryDeterministicAgentCrmReply` — visits today/tomorrow, new leads today.
- `tryDeterministicAgentVisitMutation` — same cancel/reschedule engine with agent scope.
- LangGraph tools (`cancelVisit`, `rescheduleVisit`, `listLeads`, …) for everything else.

## Layer 3 — LLM (language + persuasion, not facts)

- Buyer: `aiService.generateResponse` for open-ended chat.
- **Safety net**: if the message is still a visit change, `applyVisitMutationFromChat` **overrides** any LLM text that would repeat “Visit scheduled”.
- Prompt rule: never repeat an old confirmation when the user asked to cancel/reschedule.

## Proof (automated)

```bash
cd backend
npm test -- --testPathPattern="visitMutation|visitIntent|agent-crm-query"
```

The test `reschedules tomorrow visit to Saturday 1pm for buyer` uses the exact screenshot message.

## Production

After deploy, verify on WhatsApp:

`Cancel my site visit which is on tomorrow and reschedule it to this saturday 1pm`

Expected: **Visit rescheduled**, **Saturday** 1:00 pm, **Sunset Heights** — not Friday’s slot repeated.
