# WhatsApp Integration - Comprehensive Verification Checklist

> Master verification checklist for implementing and testing WhatsApp Business API integration in Investo CRM.
> Generated: 2026-03-19

---

## SECTION 1: WHATSAPP INTEGRATION VERIFICATION CHECKLIST

### A. Webhook Configuration & Setup

- [ ] **A1. Dynamic webhook URL per company** - Webhook URL should be configurable per company (e.g., `/api/webhook/:companyId`) instead of single static endpoint `/api/webhook`
- [ ] **A2. Webhook verification token handling** - Each company should have own `verifyToken` in `company.settings.whatsapp.verifyToken` for webhook verification
- [ ] **A3. Webhook signature verification (HMAC-SHA256)** - Implement `x-hub-signature-256` header verification using company-specific `appSecret`
- [ ] **A4. IP whitelist for Meta webhook servers** - Add IP whitelist validation for known Meta/Facebook IP ranges (currently missing)
- [ ] **A5. Dynamic webhook URL generation per company** - Company configuration should include dynamic webhook callback URL
- [ ] **A6. Multi-webhook support** - Support multiple WhatsApp phone numbers per company with separate webhooks

### B. Message Reception & Processing

- [ ] **B1. Webhook event deduplication** - Implement messageId-based deduplication to prevent duplicate processing of same message
- [ ] **B2. Asynchronous processing** - Return HTTP 200 within 5 seconds (Meta requirement), process messages in background
- [ ] **B3. Message type support (text)** - Text messages are currently handled (see `webhook.routes.ts:93`)
- [ ] **B4. Message type support (image)** - Need to implement image message handling with media URL download
- [ ] **B5. Message type support (document)** - Need to implement document/file message handling
- [ ] **B6. Message type support (location)** - Need to implement location message handling
- [ ] **B7. Message type support (voice)** - Need to implement voice/audio message handling with transcription
- [ ] **B8. Multi-tenant company lookup by phoneNumberId** - Implemented in [`whatsapp.service.ts:25-74`](backend/src/services/whatsapp.service.ts:25)
- [ ] **B9. Error handling and logging** - Basic error logging exists, need structured error handling with retry logic

### C. Message Sending & Delivery

- [ ] **C1. Outbound message rate limiting (80 msg/sec)** - Meta limit of 80 messages/second per phone number NOT implemented
- [ ] **C2. Company-level rate limiting** - Need per-company rate limiting (e.g., 1000 messages/hour)
- [ ] **C3. Exponential backoff retry mechanism** - NOT implemented - messages fail silently on API error
- [ ] **C4. Circuit breaker pattern for Meta API failures** - NOT implemented - no protection against Meta API outages
- [ ] **C5. Dead letter queue for failed messages** - NOT implemented - failed messages are lost
- [ ] **C6. Message status tracking (sent → delivered → read)** - NOT implemented - no webhook handling for status updates
- [ ] **C7. Template message support** - Need WhatsApp template message support for notifications
- [ ] **C8. Interactive messages (buttons, lists)** - Need button/list message types for rich interactions

### D. Queue & Scalability

- [ ] **D1. Redis-based message queue (Bull/BullMQ)** - NOT implemented - all processing is synchronous
- [ ] **D2. Queue workers for horizontal scaling** - Need BullMQ with worker processes
- [ ] **D3. Concurrent message processing limits** - Need to limit concurrent messages per phone number
- [ ] **D4. Queue monitoring and management** - Need queue health check endpoints and admin UI
- [ ] **D5. Priority queues** - Need priority queue for agent messages over AI responses
- [ ] **D6. Scheduled message delivery** - Need scheduled message queue for reminders

### E. Security & Reliability

- [ ] **E1. Webhook signature verification** - Implemented in [`webhook.routes.ts:53-68`](backend/src/routes/webhook.routes.ts:53)
- [ ] **E2. IP whitelist enforcement** - NOT implemented - no IP validation for incoming requests
- [ ] **E3. Request size limits on webhook endpoints** - Need to add body-parser limits
- [ ] **E4. Phone number masking in logs** - Partially implemented in [`webhook.routes.ts:101`](backend/src/routes/webhook.routes.ts:101)
- [ ] **E5. Health check endpoints for WhatsApp connection** - [`testConnection()`](backend/src/services/whatsapp.service.ts:303) exists but not exposed as API
- [ ] **E6. Rate limiting on webhook POST** - Need rate limiting to prevent webhook abuse
- [ ] **E7. Webhook retry from Meta** - Meta retries webhooks on 500 errors - need idempotency

### F. AI Integration & Response

- [ ] **F1. AI response generation with language detection** - Implemented in [`ai.service.ts`](backend/src/services/ai.service.ts)
- [ ] **F2. Property matching based on conversation context** - Implemented in [`whatsapp.service.ts:182-185`](backend/src/services/whatsapp.service.ts:182)
- [ ] **F3. Conversation state management (ai_active vs agent_active)** - Implemented in [`whatsapp.service.ts:167`](backend/src/services/whatsapp.service.ts:167)
- [ ] **F4. Lead auto-creation with round-robin assignment** - Implemented in [`whatsapp.service.ts:102-129`](backend/src/services/whatsapp.service.ts:102)
- [ ] **F5. Multi-language support (11 languages)** - Implemented (en, hi, kn, te, ta, ml, mr, bn, gu, pa, or)
- [ ] **F6. Working hours enforcement** - Need to implement AI working hours based on company settings
- [ ] **F7. AI response time < 10 seconds** - Need to monitor and enforce SLA

### G. Enterprise Features

- [ ] **G1. Company-specific WhatsApp configuration** - Implemented in `company.settings.whatsapp`
- [ ] **G2. Multiple phone number support per company** - Need multi-phone number architecture
- [ ] **G3. Template message support for notifications** - Need WhatsApp Business Template management
- [ ] **G4. Delivery and read receipt handling** - Need webhook handler for message status updates
- [ ] **G5. Conversation handoff between AI and human agents** - Partially implemented via status toggle
- [ ] **G6. Agent takeover notifications** - Implemented in [`whatsapp.service.ts:244-254`](backend/src/services/whatsapp.service.ts:244)
- [ ] **G7. WhatsApp business phone number verification** - Need admin UI for phone number setup
- [ ] **G8. Message history retention** - Need data retention policy implementation

---

## SECTION 2: CURRENT STATE vs TARGET STATE

### A. Webhook Configuration & Setup

| Item | Status | Current Behavior | Expected Behavior |
|------|--------|------------------|-------------------|
| A1. Dynamic webhook URL per company | [-] | Single static `/api/webhook` endpoint | Per-company webhook URL `/api/webhook/:companyId` |
| A2. Webhook verification token | [-] | Single `config.whatsapp.verifyToken` | Company-specific verifyToken from settings |
| A3. Webhook signature verification | [x] | HMAC-SHA256 implemented | Fully implemented |
| A4. IP whitelist | [ ] | Not implemented | Whitelist Meta IPs |
| A5. Dynamic webhook URL generation | [ ] | Not implemented | Company config stores callback URL |
| A6. Multi-webhook support | [ ] | Not implemented | Multiple phones per company |

### B. Message Reception & Processing

| Item | Status | Current Behavior | Expected Behavior |
|------|--------|------------------|-------------------|
| B1. Event deduplication | [ ] | Not implemented | messageId-based dedup with Redis |
| B2. Async processing | [x] | Returns 200 immediately | 200 returned, async processing |
| B3. Text messages | [x] | Handled | Fully implemented |
| B4. Image messages | [ ] | Not handled | Download and store image |
| B5. Document messages | [ ] | Not handled | Download and store document |
| B6. Location messages | [ ] | Not handled | Parse and store location |
| B7. Voice messages | [ ] | Not handled | Download and transcribe |
| B8. Multi-tenant lookup | [x] | phoneNumberId lookup works | Fully implemented |
| B9. Error handling | [-] | Basic logging | Structured error handling |

### C. Message Sending & Delivery

| Item | Status | Current Behavior | Expected Behavior |
|------|--------|------------------|-------------------|
| C1. Rate limiting 80/sec | [ ] | Not implemented | Token bucket per phone |
| C2. Company rate limits | [ ] | Not implemented | Per-company limits |
| C3. Exponential backoff | [ ] | Not implemented | Retry with backoff |
| C4. Circuit breaker | [ ] | Not implemented | Circuit breaker pattern |
| C5. Dead letter queue | [ ] | Not implemented | DLQ for failed messages |
| C6. Status tracking | [ ] | Not implemented | Track sent/delivered/read |
| C7. Template messages | [ ] | Not implemented | Template management |
| C8. Interactive messages | [ ] | Not implemented | Buttons and lists |

### D. Queue & Scalability

| Item | Status | Current Behavior | Expected Behavior |
|------|--------|------------------|-------------------|
| D1. Redis queue (BullMQ) | [ ] | Not implemented | BullMQ integration |
| D2. Queue workers | [ ] | Not implemented | Worker processes |
| D3. Concurrent limits | [ ] | Not implemented | Per-phone limits |
| D4. Queue monitoring | [ ] | Not implemented | Health endpoints |
| D5. Priority queues | [ ] | Not implemented | Agent > AI priority |
| D6. Scheduled messages | [ ] | Not implemented | Schedule reminders |

### E. Security & Reliability

| Item | Status | Current Behavior | Expected Behavior |
|------|--------|------------------|-------------------|
| E1. Signature verification | [x] | Implemented | Fully implemented |
| E2. IP whitelist | [ ] | Not implemented | Meta IP validation |
| E3. Request size limits | [ ] | Not implemented | Add body limits |
| E4. Phone masking in logs | [x] | Partial masking | Fully masked |
| E5. Health checks | [-] | Method exists | Expose as API |
| E6. Rate limiting on webhook | [ ] | Not implemented | Add rate limits |
| E7. Webhook idempotency | [ ] | Not implemented | Handle retries |

### F. AI Integration & Response

| Item | Status | Current Behavior | Expected Behavior |
|------|--------|------------------|-------------------|
| F1. Language detection | [x] | Implemented | Fully implemented |
| F2. Property matching | [x] | Implemented | Fully implemented |
| F3. Conversation state | [x] | ai_active/agent_active | Fully implemented |
| F4. Round-robin assignment | [x] | Implemented | Fully implemented |
| F5. Multi-language | [x] | 11 languages | Fully implemented |
| F6. Working hours | [ ] | Not implemented | Respect company hours |
| F7. Response time SLA | [ ] | Not monitored | Enforce <10s |

### G. Enterprise Features

| Item | Status | Current Behavior | Expected Behavior |
|------|--------|------------------|-------------------|
| G1. Company-specific config | [x] | In settings | Fully implemented |
| G2. Multiple phones | [ ] | Not supported | Multi-phone architecture |
| G3. Template messages | [ ] | Not implemented | Template CRUD |
| G4. Status webhooks | [ ] | Not implemented | Delivery receipts |
| G5. Agent handoff | [-] | Basic toggle | Full handoff flow |
| G6. Takeover notifications | [x] | Implemented | Fully implemented |
| G7. Phone number UI | [ ] | Not implemented | Admin setup UI |
| G8. Message retention | [ ] | Not implemented | Retention policy |

---

## SECTION 3: IMPLEMENTATION CHUNKS

### Chunk 1: Core Webhook Infrastructure ⭐ Priority: HIGH
**Estimated Effort**: 2-3 days

- [ ] 1.1 Add IP whitelist validation for Meta webhook servers
- [ ] 1.2 Implement request size limits on webhook endpoints
- [ ] 1.3 Create webhook health check endpoint (`GET /api/webhook/health`)
- [ ] 1.4 Expose WhatsApp connection test as API endpoint
- [ ] 1.5 Add webhook retry handling (idempotency)
- [ ] 1.6 Add rate limiting on webhook POST endpoint

**Test Criteria**:
- Webhook accepts requests only from Meta IPs
- Large payloads are rejected
- Health endpoint returns WhatsApp connection status

---

### Chunk 2: Message Queue & Async Processing ⭐ Priority: HIGH
**Estimated Effort**: 3-4 days

- [ ] 2.1 Install and configure BullMQ
- [ ] 2.2 Create message processing queue (`whatsapp-messages`)
- [ ] 2.3 Refactor webhook handler to add jobs to queue instead of processing sync
- [ ] 2.4 Create queue worker process
- [ ] 2.5 Implement priority queues (agent messages > AI responses)
- [ ] 2.6 Add queue monitoring endpoints
- [ ] 2.7 Implement graceful worker shutdown

**Test Criteria**:
- Messages are queued and processed asynchronously
- Worker can be scaled horizontally
- Queue health is exposed via API

---

### Chunk 3: Retry & Reliability ⭐ Priority: HIGH
**Estimated Effort**: 2-3 days

- [ ] 3.1 Implement message deduplication with Redis (check messageId)
- [ ] 3.2 Add exponential backoff retry (3 attempts, 1s → 2s → 4s)
- [ ] 3.3 Implement circuit breaker pattern for Meta API
- [ ] 3.4 Create dead letter queue for failed messages
- [ ] 3.5 Add DLQ processing/retry admin endpoint
- [ ] 3.6 Implement scheduled message queue for reminders

**Test Criteria**:
- Duplicate messages are not processed twice
- Failed messages are retried with backoff
- Circuit breaker opens after N failures
- Failed messages end up in DLQ

---

### Chunk 4: Rate Limiting & Outbound Control ⭐ Priority: MEDIUM
**Estimated Effort**: 2-3 days

- [ ] 4.1 Implement token bucket for 80 msg/sec per phone number
- [ ] 4.2 Add company-level rate limiting (configurable)
- [ ] 4.3 Create rate limit dashboard in admin panel
- [ ] 4.4 Implement outbound message queue with rate limiting
- [ ] 4.5 Add rate limit headers to API responses

**Test Criteria**:
- Cannot exceed 80 messages/second
- Company limits are enforced
- Rate limit info visible in admin

---

### Chunk 5: Media & Advanced Messages ⭐ Priority: MEDIUM
**Estimated Effort**: 3-4 days

- [ ] 5.1 Implement image message handling (download, store, forward)
- [ ] 5.2 Implement document message handling
- [ ] 5.3 Implement voice message handling (download + transcription)
- [ ] 5.4 Implement location message handling
- [ ] 5.5 Add WhatsApp template message support
- [ ] 5.6 Add interactive message support (buttons, lists)
- [ ] 5.7 Create media storage in cloud (S3) or local

**Test Criteria**:
- Images, documents, voice are saved
- Templates can be sent
- Interactive buttons work

---

### Chunk 6: Message Status & Delivery Tracking ⭐ Priority: MEDIUM
**Estimated Effort**: 2-3 days

- [ ] 6.1 Add webhook handler for message status updates
- [ ] 6.2 Update message status in database (sent → delivered → read)
- [ ] 6.3 Create delivery analytics (open rates, response times)
- [ ] 6.4 Add status webhooks to conversation timeline
- [ ] 6.5 Implement read receipt handling

**Test Criteria**:
- Status updates are received and stored
- Delivery analytics are accurate
- Read receipts trigger automation

---

### Chunk 7: Enterprise Features & Admin UI ⭐ Priority: LOW
**Estimated Effort**: 4-5 days

- [ ] 7.1 Add WhatsApp configuration UI for company admin
- [ ] 7.2 Support multiple phone numbers per company
- [ ] 7.3 Create template message management UI
- [ ] 7.4 Add WhatsApp analytics dashboard
- [ ] 7.5 Implement message search and export
- [ ] 7.6 Add bulk message sending with scheduling
- [ ] 7.7 Create team assignment rules UI

**Test Criteria**:
- Admins can configure WhatsApp settings
- Multiple phones work with separate configurations
- Templates are manageable via UI

---

## IMPLEMENTATION DEPENDENCY GRAPH

```
Chunk 1 (Core Webhook)
    ↓
Chunk 2 (Queue) ← Depends on Chunk 1
    ↓
Chunk 3 (Retry) ← Depends on Chunk 2
    ↓
Chunk 4 (Rate Limiting) ← Depends on Chunk 3
    ↓
Chunk 5 (Media)
    ↓
Chunk 6 (Status Tracking)
    ↓
Chunk 7 (Enterprise UI)
```

## QUICK START IMPLEMENTATION ORDER

1. **Start with Chunk 1** - Security fundamentals
2. **Then Chunk 2** - Async processing foundation
3. **Then Chunk 3** - Reliability improvements
4. **Then Chunk 4** - Rate limiting
5. **Then Chunk 5** - Media support
6. **Then Chunk 6** - Delivery tracking
7. **Finally Chunk 7** - Admin features

---

## KEY FILES REFERENCE

| File | Purpose |
|------|---------|
| [`backend/src/routes/webhook.routes.ts`](backend/src/routes/webhook.routes.ts) | Webhook endpoints |
| [`backend/src/services/whatsapp.service.ts`](backend/src/services/whatsapp.service.ts) | Core WhatsApp logic |
| [`backend/src/services/ai.service.ts`](backend/src/services/ai.service.ts) | AI response generation |
| [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) | Database schema |

---

## NOTES

- Current implementation is **60% production-ready** for basic WhatsApp messaging
- Missing critical production features: queue, retry, rate limiting, media handling
- Estimated total implementation time: 16-24 days for all chunks
- Recommend implementing Chunks 1-4 before any production WhatsApp traffic