# Investo architecture (concise)

## Runtime services

| Service | Host | Role |
|---------|------|------|
| `investo-backend-v2` | Render | Express API, WhatsApp webhooks, agent copilot |
| `investo-worker` | Render | Property import queue consumer |
| Frontend | Vercel (`biginvesto.online`) | React CRM + analytics |

## Inbound WhatsApp

```
Meta / GreenAPI webhook
  → POST /api/webhook or /api/greenapi/webhook
  → inboundWhatsAppRouting (staff vs buyer)
  → Staff: agent-router (deterministic → workflow LLM → intent → LangGraph + RAG)
  → Buyer: visit booking → buyer workflow → ai.service (RAG + knowledge) → polish → presence delay → send
```

## Data

- **PostgreSQL** — Prisma ORM (leads, visits, conversations, companies)
- **Upstash Redis** — cache, rate limits, queues (optional fallback: memory)
- **Vector** — `client_memory_chunks`, property knowledge embeddings

## Key modules

- `workflow-engine.service.ts` — 15 CRM workflows, 45+ actions
- `agent-intent-orchestrator.service.ts` — classify / extract / execute
- `clientMemory.service.ts` — per-lead RAG for staff + buyer
- `whatsapp.service.ts` — outbound rich messages + inbound state machine

## Health

`GET /api/health` — DB, OpenAI, storage, `ai_capabilities`, `production_polish`, `ops_metrics`.
