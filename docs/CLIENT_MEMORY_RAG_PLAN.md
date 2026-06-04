# Per-client RAG memory — plan

## Goal
Staff and buyer WhatsApp AI can recall **full client history** (chats, visits, bookings, actions) via vector RAG, not only the last ~20 chat turns.

## Architecture

| Layer | Implementation |
|-------|----------------|
| Storage | `client_memory_chunks` (pgvector), scoped by `company_id` + `lead_id` |
| Index sources | WhatsApp messages, visits, lead profile, agent action logs |
| Retrieval | Cosine search on staff query; inject into agent/buyer system prompt |
| Session focus | `agent_sessions.last_lead_id` / `last_visit_id` updated on visit notify + resolve |
| Embeddings | Reuse `createTextEmbeddings` from property knowledge (OpenAI + local fallback) |

## Flow

1. **Write path**: On message / visit / lead change → `syncLeadClientMemory(leadId)` (incremental chunk).
2. **Read path**: Before `invokeAgent` / buyer LLM → `searchClientMemory` + `formatClientMemoryForPrompt`.
3. **Resolve client**: Session context → name/phone in message → next upcoming visit lead.

## Verification (implemented)

- `client_memory_chunks` + `agent_sessions.last_lead_id` / `last_visit_id`
- Index on inbound WhatsApp, visit notify, visit reschedule
- Staff copilot: RAG block in system prompt; session focus on visit notify
- Buyer AI: per-lead RAG in goal-directed prompt
- Tests: `clientMemory.service.test.ts`, `agent-crm-query` confirm with session visit
