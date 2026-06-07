# Investo — Technical Requirements Document (TRD)

| Field | Value |
|-------|-------|
| Product | Investo — Real Estate AI SaaS Platform |
| Backend version | 0.1.10 |
| Document | Technical Requirements Document |
| Last updated | 2026-06-07 |

---

## 1. Purpose & scope

This TRD describes **how** Investo is built: the technology stack, system components, data flow, AI pipeline, integrations, security, and operational requirements. It is the engineering counterpart to the PRD.

---

## 2. Technology stack

### 2.1 Backend
| Concern | Technology |
|---------|-----------|
| Runtime | Node.js + TypeScript (strict) |
| Web framework | Express 4 |
| ORM | Prisma 7 (`@prisma/client`) with Neon/PG adapters |
| Database | PostgreSQL 15 + `pgvector` + `uuid-ossp` |
| Cache / locks / queues | Redis (Upstash) with in-memory fallback |
| Realtime | Socket.IO |
| AI providers | OpenAI (primary), Kimi, Claude/Anthropic; LangChain + LangGraph for agentic staff flows |
| WhatsApp | Meta WhatsApp Cloud API (Green API legacy webhook also supported) |
| Auth | JWT (`jsonwebtoken`) + bcrypt + refresh tokens; `jwks-rsa` for external IdP |
| Storage | AWS S3 / SES (`@aws-sdk/*`), Supabase storage option |
| Validation | Zod |
| Parsing | `pdf-parse`, `papaparse`, `exceljs`, `xlsx`, `chrono-node` (date parsing) |
| Security | Helmet, `express-rate-limit`, `sanitize-html` |
| Jobs | `node-cron`; dedicated worker process for property import queue |
| Metrics | `prom-client` (Prometheus) |
| Logging | Winston (structured) |
| Testing | Jest + Supertest |

### 2.2 Frontend
| Concern | Technology |
|---------|-----------|
| Framework | React 18 + TypeScript |
| Build | Vite 5 |
| Styling | Tailwind CSS 3 |
| Routing | React Router 6 |
| State | Zustand |
| Realtime | socket.io-client |
| i18n | i18next + react-i18next + browser language detector |
| Animation | motion |
| Icons | lucide-react |
| HTTP | axios |
| Testing | Vitest + Testing Library + Playwright (E2E) |

### 2.3 Deployment
| Component | Host |
|-----------|------|
| Backend API | Railway (`investo-backend-production.up.railway.app`) |
| Worker (import queue) | Railway / Render worker process |
| Frontend | Vercel (`biginvesto.online`) |
| DB | Neon/Supabase PostgreSQL |
| Cache | Upstash Redis |

---

## 3. System architecture

```
                       ┌──────────────────────────────┐
 Customer WhatsApp ───►│  Meta WhatsApp Cloud API      │
 (any language)        └───────────────┬───────────────┘
                                       │ webhook (signed)
                                       ▼
                       ┌──────────────────────────────┐
                       │  Express API (Railway)        │
                       │  /api/webhook                 │
                       │   1. ACK 200 fast             │
                       │   2. Dedup (DB + Redis)       │
                       │   3. Identity route           │
                       │   4. Buyer | Staff pipeline   │
                       └───────┬───────────────┬───────┘
                               │               │
                  ┌────────────▼───┐   ┌───────▼────────────┐
                  │ Buyer pipeline │   │ Staff copilot      │
                  │ FSM + RAG + LLM│   │ classify→intent→   │
                  │ + workflows    │   │ workflow→LangGraph │
                  └───────┬────────┘   └───────┬────────────┘
                          │                    │
                          ▼                    ▼
            ┌──────────────────────────────────────────┐
            │ PostgreSQL (Prisma)   Redis   pgvector    │
            │ S3 storage            SES mail            │
            └──────────────────────────────────────────┘
                          ▲
                          │ REST + WebSocket
            ┌─────────────┴──────────────┐
            │ React Dashboard (Vercel)   │
            │ Role-based CRM + analytics │
            └────────────────────────────┘
```

### 3.1 Processes
- **API server** (`src/server.ts` → `app.ts`): HTTP + WebSocket, webhooks, REST.
- **Worker** (`src/worker.ts`): property import extraction queue consumer.
- **CRON jobs** (`automation.service.ts`): visit reminders (every 15 min), follow-ups, daily analytics aggregation.

---

## 4. Inbound message processing pipeline

Strict ordering for every inbound WhatsApp message (buyer + staff):

```
1.  ACK webhook (HTTP 200 immediately)
2.  Dedup claim         → inbound_whatsapp_dedup (DB) + Redis lock (claimInboundMessageFull)
3.  Identity route      → buyer | staff copilot | static notice (inboundWhatsAppRouting)
4.  Short-circuit (no LLM):
      - interactive button / list / location reply
      - pending confirmation YES/NO
      - deterministic visit-status query (buyer)
      - deterministic CRM (staff: visits today, new leads, etc.)
      - visit fast-path parse (tryCommitCustomerVisitBooking)
5.  Active-context bias (buyer mutations): if active visit → bias reschedule/cancel
6.  Workflow classifier (LLM temp 0.0):
      - mutations  ≥ 0.80 execute | 0.70–0.80 clarify | < floor fall-through
      - queries    ≥ 0.65 execute
7.  Workflow execution (atomic saga):
      - claimWorkflowExecution(idempotencyKey)
      - snapshot state before each mutation
      - on failure → compensate in reverse OR needs_reconciliation + alert
8.  Intent orchestrator (staff only, if workflow null)  — ~50 intents
9.  LangGraph (staff last resort, confidence < 0.50)
10. Policy + Language brain (buyer fallback: ai.service.generateResponse)
11. Memory write: patchLeadMemory(delta) → syncLeadClientMemory (async, RAG)
12. Action log: agent_action_logs (every autonomous step)
13. Outbound send: exactly ONE primary payload per inbound message + optional media
```

### 4.1 Buyer turn orchestrator (`whatsappTurnOrchestrator.service.ts`)
Handler cascade H1→H9, first match wins:
- **H1** Human takeover (runs before any commit — terminal)
- **H1b** Dismissal acknowledgement
- **H2** Rapport / greeting fast-path (skipped during `visit_booking`/`confirmation`/`commitment`)
- **H2b** Returning-buyer pivot
- **H3** Memory recall
- **H4** Qualification
- **H5** Visit-status query
- **H6** Visit-commit workflow
- **H7** Classifier workflow
- **H8** Visit-commit reply
- **H9** Full AI turn (policy brain + LLM + RAG + sanitize)

### 4.2 One-reply-per-turn contract
- `beginOutboundTurn` / `claimPrimaryOutboundSend` enforce at most **one** primary text/interactive bubble per inbound `messageId` (per customer phone); media is a separate addon.
- All tap-flow handlers return a single `TurnResult`; caller dispatches via `sendTurnResult` only.

---

## 5. AI engine requirements

### 5.1 Dual-brain design
- **Policy brain** (`conversationStateMachine.ts`): deterministic FSM deciding stage and `nextAction` (continue / advance_stage / handle_objection / bridge_back / escalate / close). The LLM never decides stage transitions.
- **Language brain** (`ai.service.ts`): generates the wording, grounded by RAG + approved inventory.

### 5.2 LLM hardening (every buyer call)
| Parameter | Value |
|-----------|-------|
| temperature | 0 |
| max_tokens | 300 |
| frequency_penalty | 0.4 |
| presence_penalty | 0.4 |
| stop | `\nUser:`, `Human:`, `\nCustomer:` |
| response_format | `json_object` |

Centralized in `constants/llmSafeParams.constants.ts` (`withBuyerLlmSafeParams`). Global non-negotiable rules injected via `constants/aiGlobalRules.constants.ts`.

### 5.3 Workflow classifier thresholds
| Type | Execute | Clarify band | Temp |
|------|---------|--------------|------|
| Mutations (schedule/reschedule/cancel) | ≥ 0.80 | 0.70–0.80 | 0.0 |
| Queries (price/brochure/availability/amenities) | ≥ 0.65 | 0.55–0.65 | 0.0 |
| Staff CRM | ≥ 0.62 (tightening to 0.70) | per workflow | 0.0 |

Clarification never writes DB; always logged as `workflow_clarification`.

### 5.4 Output safety pipeline (`whatsappResponseSanitizer.service.ts`)
`neverSayNo guard → strip internal metadata (UUIDs, scores, signatures) → strip robotic openers → polish → mutation/booking-claim guard → banned-phrase filter`.
- **Banned-phrase filter** (`buyerBannedPhraseFilter.util.ts`): blocks invented connection errors, mid-conversation re-welcomes, capability menus, qualification bleed during booking.
- **Safe fallback** (`safeBuyerFallback.util.ts`): never invents outages; visit-aware fallback.

### 5.5 Unified memory
- `leads.lead_memory` (JSONB) is the source of truth.
- Read: `buildPromptMemoryBlock` / `unifiedMemory.service`.
- Write: `extractAndPatchLeadMemory` (buyer) + `patchLeadMemory` (staff) → `syncLeadClientMemory` (RAG vectors, async ≤ 60 s).
- RAG vectors (`client_memory_chunks`, property knowledge embeddings) are **derived**, never a competing truth.

### 5.6 Idempotency & saga
- **Idempotency key**: `hash(workflowId + companyId + leadId/visitId + normalizedParams)`, 24 h TTL (`WorkflowIdempotencyKey`).
- **Saga**: per-run `WorkflowRunRecord` with state snapshot + step log; on failure compensate in reverse or mark `needs_reconciliation` + alert admin.

---

## 6. API surface

Base path `/api`. Auth via `Authorization: Bearer <JWT>` unless noted.

| Route group | Path | Notes |
|-------------|------|-------|
| Auth | `/api/auth` | login, refresh, me, logout (sensitive rate limit) |
| Companies | `/api/companies` | tenant CRUD (super_admin) |
| Users | `/api/users` | team management |
| Leads | `/api/leads` | CRM CRUD, assign, export |
| Property projects | `/api/property-projects` | grouping |
| Properties | `/api/properties` | listing CRUD |
| Property imports | `/api/property-imports`, `/uploads`, `/bulk` | draft/extract/publish; public upload; bulk CSV |
| Visits | `/api/visits` | scheduling + status |
| Conversations | `/api/conversations` | chat history |
| AI settings | `/api/ai-settings` | per-company AI config |
| Conversion settings | `/api/conversion-settings` | Never-Say-No brain |
| Analytics | `/api/analytics` | dashboards |
| Notifications | `/api/notifications` | in-app notifications |
| Subscriptions | `/api/subscriptions` | plans |
| Admin | `/api/admin` | platform admin |
| Roles | `/api/roles` | dynamic RBAC |
| Features | `/api/features` | feature flags |
| Onboarding | `/api/onboarding` | 6-step wizard |
| Audit | `/api/audit` | audit logs |
| Agent action logs | `/api/agent-action-logs` | AI transparency |
| Copilot | `/api/copilot` | staff AI chat (auth + `requireFeature('ai_bot')`) |
| Finance / EMI | `/api` (finance routes) | EMI calculator |
| Error logs | `/api/error-logs` | ops |
| Assignment settings | `/api/assignment-settings` | lead routing |
| Webhook | `/api/webhook` | WhatsApp inbound (signature verified) |
| Health / readiness / metrics | `/api/health`, `/api/readiness`, `/api/metrics` | no auth (health) |

### 6.1 Middleware order
`helmet → requestLogger → CORS allow-list → (webhook: rate-limit) → json/urlencoded → sanitizeInput → userRateLimiter → route-specific (auth, companyRateLimiter, AI rate limiters, featureGate) → 404 → global error handler (no internal leak)`.

---

## 7. Security requirements

| Area | Requirement |
|------|-------------|
| AuthN | JWT (24 h) + refresh token (7 d, rotation, hashed at rest); bcrypt ≥ 12 rounds; optional external IdP via JWKS |
| AuthZ | RBAC middleware on every endpoint; dynamic role permissions resolved from `company_roles`; feature-flag gate |
| Tenant isolation | `company_id` injected server-side from JWT; every query filters tenant; client-provided company_id ignored |
| Transport | TLS everywhere; HSTS via Helmet |
| Input | Zod validation; `sanitize-html`; parameterized queries (Prisma) |
| Rate limiting | 100/min per user, 1000/min per company, stricter for auth & AI, webhook limiter |
| Webhook | Meta signature verification; dedup before processing |
| Secrets | Environment variables only; never logged; full phone numbers masked in logs |
| Data | Money DECIMAL; UUID PKs; phones E.164; 90-day retention post-deactivation; GDPR delete |

---

## 8. Integrations

| Integration | Purpose | Notes |
|-------------|---------|-------|
| Meta WhatsApp Cloud API | Inbound/outbound messages, media, interactive | Per-tenant phone number id + token in `company.settings.whatsapp.meta` |
| OpenAI / Kimi / Claude | Language brain, classifiers, extraction | Provider order with fallback; temp 0 buyer |
| LangGraph | Staff agentic tool-calling fallback | Postgres checkpointer |
| AWS S3 | Media/brochure storage | Signed URLs |
| AWS SES / SMTP | Transactional mail (invites, resets) | Health-checked |
| pgvector | RAG embeddings | `client_memory_chunks`, property knowledge |
| Upstash Redis | Cache, locks, dedup, queues | Memory fallback |
| Prometheus | Metrics scrape | `/api/metrics` |

---

## 9. Performance & reliability targets

| Metric | Target |
|--------|--------|
| API p95 | < 500 ms |
| Webhook processing | < 3 s (ACK < 5 s) |
| AI generation | < 10 s (28 s hard timeout in orchestrator) |
| Dashboard load | < 2 s |
| Indexed query | < 100 ms |
| Uptime | 99.5% |
| DB pool | min 10 / max 50 per instance |

---

## 10. Observability & ops

- **Health**: `GET /api/health` (DB, AI, storage, mail, ai_capabilities, ops_metrics), `/api/health/live`, `/api/readiness`.
- **Metrics**: `prom-client` counters (`http_requests`, `webhook_inbound`, `ai_replies`, `workflow_runs`, `workflow_idempotency_hits`, `workflow_clarification`, `whatsapp_outbound`, `errors_5xx`, `rate_limited`, `slow_requests`).
- **Action logs**: `agent_action_logs` for every autonomous step (trigger, actor, action, inputs, result, status, duration).
- **Audit logs**: `audit_logs` for write operations.
- **Structured logging**: Winston JSON; request IDs propagated.

---

## 11. Testing requirements

| Layer | Tooling | Coverage target |
|-------|---------|-----------------|
| Unit (70%) | Jest | State machines, RBAC, validation, AI prompt build, dedup, sanitizer, banned-phrase, idempotency |
| Integration (20%) | Jest + Supertest | Auth, CRUD, webhook, AI flow, visit conflict, audit |
| E2E (10%) | Playwright | Login, action logs, key flows |
| Workflow matrix | Jest | 49+ phrase→workflow mappings |
| Frontend | Vitest + Testing Library | Components, pages |

CI gate: build + full unit/integration suite must pass before deploy. Production smoke (Railway health/curl) + handset matrix (12 scenarios) for AI-touching changes.

---

## 12. Environment configuration

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection |
| `REDIS_URL` / Upstash creds | Cache/locks/queues |
| `OPENAI_API_KEY`, `AI_PROVIDER`, `AI_MODEL` | AI provider |
| `KIMI_API_KEY`, `CLAUDE_API_KEY` | Fallback providers |
| `WHATSAPP_*` (phone id, token, verify token) | Meta API (also per-company in settings) |
| `JWT_SECRET`, token TTLs | Auth |
| AWS creds (`S3`, `SES`) | Storage + mail |
| `AGENT_AI_LLM_ENABLED`, `AGENT_AI_TEMPERATURE` | Staff agent toggles |
| `LANGGRAPH_ENABLED` | Staff agentic fallback |
| CORS allow-list origins | Frontend domains |

---

## 13. Constraints

- No raw SQL in route handlers (use Prisma).
- No local file storage in production (use S3).
- No hardcoded config (env vars only).
- No deploy without green test suite.
- Buyer LLM must use safe-param wrapper (temp 0).
- Every DB query for tenant data must include `company_id`.
