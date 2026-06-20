# Chunk 02 — Conversations: Visibility, Takeover & Staff Reply

| Field | Value |
|-------|-------|
| Chunk | 02 of 7 |
| Pillar | 2 — Conversation is visible and controllable |
| Priority | P0 |
| Depends on | Chunks 01, 03 |
| Unblocks | Chunk 06 (conversion metrics) |

---

## 1. Single-feature scope

**One focus only:** Staff and admins can **see full buyer threads**, **take over from AI**, and **reply from dashboard or WhatsApp copilot** — with messages persisted, ordered, and tenant-isolated in real time.

Out of scope: lead creation (Chunk 01), visit scheduling (Chunk 04).

---

## 2. Current state — NOW

### 2.1 Production today (working)

| Capability | Status | Code / route |
|--------------|--------|--------------|
| Conversation list + thread view | ✅ | `ConversationsPage`, `GET /api/conversations` |
| Message history (AI + agent + buyer) | ✅ | `messages` table, conversation routes |
| Agent takeover flag | ✅ | takeover endpoints on conversation |
| Send message from dashboard | ✅ | `POST /api/conversations/:id/messages` |
| Staff WhatsApp copilot | ✅ | `agent-router.service`, inbound staff routing |
| Socket live updates | ✅ | `SocketContext`, notification events |
| AI action logs | ✅ | `AIActionLogsPage`, `agent-action-log.routes` |

### 2.2 Test-only / partial / gaps

| Gap | Impact |
|-----|--------|
| WhatsApp send fails silently if tenant Meta not configured | Agent thinks message sent |
| Async pipeline off → long webhook ack under load | Meta retries, duplicate processing risk mitigated by dedup |
| Viewer role write attempts | Cryptic errors (partially fixed via copilot role filter) |
| Real-time push incomplete | User must refresh occasionally |
| Message archive (`FEATURE_MESSAGE_ARCHIVE`) | Off — no long-term cold storage tier |

### 2.3 User experience TODAY

| Persona | Experience |
|---------|------------|
| **Agent** | Opens Conversations → sees threads → can reply if WhatsApp configured. Copilot on personal phone for CRM commands. |
| **Admin** | Same + can review AI action logs. |
| **Buyer** | Only sees WhatsApp; no dashboard. May get interactive buttons (property filters, book visit). |
| **Viewer** | Read-only; write attempts blocked. |

---

## 3. Target state — AFTER

### 3.1 Perfect functioning

- Dashboard send → Meta delivery confirmed (or explicit failure toast with retry).
- Takeover: AI stops auto-replying until release; state visible in thread header.
- Socket: new inbound message appears in open thread < 2s without refresh.
- Staff copilot write intents respect RBAC before execution (viewer never hits 500).
- Conversation stage FSM consistent with lead status (no "negotiation" thread with `new` lead unless intentional).

### 3.2 User experience AFTER

| Persona | After fix |
|---------|-----------|
| **Agent** | Red banner when WhatsApp disconnected; queue indicator when async pipeline processing. |
| **Admin** | Export thread snippet for dispute resolution; AI governance queue for flagged replies. |
| **Buyer** | Seamless handoff: "An agent will continue this chat" once takeover active. |

---

## 4. Implementation plan

### Phase 1 — Reliability (week 1)

| Task | Files |
|------|-------|
| Explicit send failure UX | `ConversationsPage`, `conversation.routes.ts`, `whatsapp.service.ts` |
| Takeover state in thread API | `conversation.routes.ts`, `ConversationsPage` header |
| Socket reconnect + backlog fetch | `SocketContext.tsx`, `notification.routes` |

### Phase 2 — Async & dedup (week 2)

| Task | Files |
|------|-------|
| Enable `FEATURE_ASYNC_WHATSAPP_PIPELINE` on Railway | env + `whatsappInboundQueue.service` |
| Dead letter admin UI wired | `DeadLetterPage`, `dead-letter.routes` |
| Meta circuit breaker metrics | `ObservabilityPage`, health deps |

### Phase 3 — Governance (week 3)

| Task | Files |
|------|-------|
| Enable `FEATURE_MESSAGE_ARCHIVE` | `messageArchive.service.ts` |
| AI review queue for outbound | `aiReviewQueue.service.ts`, `AiGovernancePage` |

---

## 5. Enterprise hardening

| Control | Requirement |
|---------|-------------|
| Tenant isolation | Conversations scoped by `companyId`; staff phone routes to own company only |
| Audit | `conversation.takeover`, `message.sent` logged |
| Content safety | Outbound sanitizer strips internal workflow leaks |
| Rate limits | `RATE_LIMIT_WHATSAPP_AI`, company AI rate limiter on copilot |
| Encryption | Message bodies at rest optional via PII flag |

**Kill switch:** `FEATURE_ASYNC_WHATSAPP_PIPELINE=false` reverts to inline processing (higher latency, simpler ops).

---

## 6. Real-time usage scenarios

```
Buyer: "Send brochure for Project X"
  → AI sends media + buttons (whatsappInteractiveOrchestrator)
Agent opens /dashboard/conversations/:id
  → Socket pushes new buyer reply live
Agent clicks Takeover
  → AI paused; agent types reply → Meta API → buyer handset
Staff phone: "Show today's visits"
  → Copilot intent → calendar summary on WhatsApp
```

---

## 7. Tests & proof gates

| Gate | Command |
|------|---------|
| Conversation send unit | `npx jest src/tests/unit/conversation.routes.send-message.test.ts` |
| Interactive orchestrator | `npx jest src/tests/unit/whatsappInteractiveOrchestrator.test.ts` |
| Webhook reliability | `npx jest src/tests/integration/webhook-async.pipeline.test.ts` |
| Production | Send staff copilot command on prod tenant; verify DB message row |
| Handset | `e2e-handset-proof.mjs` — thread continuity |

---

## 8. Feature flags & env

| Flag | Purpose |
|------|---------|
| `conversation_center` (tenant) | Module access |
| `FEATURE_ASYNC_WHATSAPP_PIPELINE` | Queue inbound |
| `FEATURE_META_CIRCUIT_BREAKER` | Stop hammering Meta when down |
| `FEATURE_MESSAGE_ARCHIVE` | Cold storage |
| `FEATURE_AI_REVIEW_QUEUE` | Human review before send (enterprise) |

---

## 9. Definition of done

- [ ] Dashboard reply reaches buyer handset on production tenant
- [ ] Takeover prevents next AI auto-reply (verified in thread)
- [ ] Send failure shows user-visible error (not silent)
- [ ] Socket updates open conversation without manual refresh
- [ ] Dead letter queue empty or actionable on observability page
- [ ] Production smoke: `GET /conversations` 200

---

## 10. Rollout

1. Staging: enable async pipeline → load test 50 concurrent webhooks
2. Production: enable async + monitor `message-failures` dashboard 48h
3. Pilot one agency → full handset regression before all tenants
