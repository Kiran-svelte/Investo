# Investo — Application Flow

| Field | Value |
|-------|-------|
| Document | App Flow (user journeys + system flows) |
| Last updated | 2026-06-07 |

This document maps the end-to-end flows for every actor: buyers (WhatsApp), staff (dashboard + WhatsApp copilot), and system automations.

---

## 1. High-level flow map

```
                         ┌────────────────────────┐
                         │  Real estate company    │
                         └───────────┬─────────────┘
                                     │ onboard
                                     ▼
        ┌──────────────────────────────────────────────────┐
        │ Company configured: roles, features, AI, inventory│
        └───────────┬──────────────────────┬────────────────┘
                    │                       │
        Buyer messages WhatsApp     Staff use dashboard / WhatsApp copilot
                    │                       │
                    ▼                       ▼
        AI funnel → visit booked     Manage leads, properties, visits, analytics
                    │
                    ▼
        Reminders → visit → close (won/lost)
```

---

## 2. Company onboarding flow

```
Sign up / provisioned by super_admin
  → Login (mustChangePassword? → ChangePassword)
  → Onboarding wizard (CompanyOnboarding tracks step_completed 0–6)
      Step 1: Company profile  (name, slug, WhatsApp number, logo, color)
      Step 2: Roles            (pick/define roles + JSON permissions → company_roles)
      Step 3: Features         (toggle ai_bot, analytics, visit_scheduling → company_features)
      Step 4: AI config        (business info, tone, persuasion, languages, FAQ → ai_settings)
      Step 5: Invite team      (invites → users, temp passwords, custom role titles)
      Step 6: Complete         (completed_at set)
  → Redirect to role landing page
```

API: `POST /api/onboarding/{setup|roles|features|ai|invite|complete}`, `GET /api/onboarding/status`.

---

## 3. Authentication flow

```
POST /api/auth/login (email + password)
  → bcrypt verify → issue { user, tokens: { access (24h), refresh (7d) } }
  → frontend stores tokens (Zustand auth store)
  → access expires → POST /api/auth/refresh (rotates refresh token)
  → GET /api/auth/me hydrates session
  → logout → revoke refresh token

Password reset: forgot → email token (PasswordResetToken) → reset → login.
First login: mustChangePassword=true → forced ChangePassword page.
```

JWT claims: `{ userId, companyId, role }`. `companyId` is the tenant key for all downstream queries.

---

## 4. Buyer WhatsApp conversation flow (core)

### 4.1 Inbound message lifecycle

```
Customer sends WhatsApp message
  → Meta Cloud API → POST /api/webhook (signature verified)
  → ACK 200 immediately
  → Dedup claim (inbound_whatsapp_dedup + Redis lock)   ── duplicate? stop
  → Identity route: unknown phone → BUYER pipeline
  → Lead auto-create if new (status=new) + Conversation (ai_active, stage=rapport)
  → Buyer turn orchestrator (H1–H9 cascade)
  → Build ONE TurnResult (text + optional buttons + optional media)
  → Sanitize (never-say-no, strip metadata, banned-phrase filter)
  → Presence delay (typing) → send via Meta API
  → Persist message, patch lead_memory, sync RAG, log action
```

### 4.2 Goal-directed funnel (conversation stages)

```
rapport ──► qualify ──► shortlist ──► objection_handling ──► commitment
                                            │                     │
                                            ▼                     ▼
                                      (loops back)          visit_booking ──► confirmation ──► closed_won
                                                                  │
                          any point: explicit human request / price negotiation / repeated objection
                                                                  ▼
                                                          human_escalated
```

Stage transitions are governed by the FSM (`isAllowedStageTransition`) — the LLM cannot regress from a booking stage back to early funnel unless the buyer explicitly restarts.

### 4.3 Example happy path

```
Buyer: "Hi, 3BHK in Whitefield under 1.5Cr?"   [lang detect: en, stage rapport→qualify]
AI:    Acknowledges + queries approved inventory → presents 2–3 matches [stage shortlist]
       (sends images / brochure if available; quick-reply buttons: Book Visit / Details / EMI)
Buyer: taps "Book Visit"                         [interactive reply → short-circuit]
AI:    Offers time-slot buttons                  [stage commitment→visit_booking]
Buyer: taps a slot
AI:    Creates Visit (scheduled) → either auto-confirm OR pending-approval to agent
       Single confirmation message + (optional) location pin [stage confirmation]
System: schedules reminders (24h / 1h / 15min)
```

### 4.4 Visit booking branches

```
Buyer requests slot
  → tryCommitCustomerVisitBooking / handleVisitTimeSlot
  → claimWorkflowExecution(idempotencyKey)        ── duplicate tap? return cached reply, no 2nd visit
  → create Visit (scheduled)
  → autoConfirmVisits == true ?
        yes → status confirmed, notify agent (no approval needed)
        no  → createVisitApprovalRequest → agent gets interactive Approve/Reject button
              (buyer told "pending confirmation", suppressCustomerMessage avoids dup)
  → on agent approve → visit confirmed → buyer notified
```

### 4.5 Objection handling

```
Buyer raises objection (too expensive / just looking / location / trust / competitor / family)
  → classifyMessageIntent → objection type
  → PolicyBrain: handle_objection (track objectionCount, consecutiveObjections)
  → Never-Say-No engine offers alternative (lower inventory, fractional, rent-to-own, partner referral, waitlist)
  → repeated unresolved (>= threshold) → escalate to human
```

### 4.6 Agent takeover

```
Buyer: "I want to talk to a person"  OR  agent toggles takeover in dashboard
  → Conversation.status = agent_active, aiEnabled = false
  → AI STOPS sending (H1 takeover handler is terminal)
  → Agent replies (via WhatsApp forward or coordinates offline)
  → Agent releases → ai_active  OR  conversation closed
```

---

## 5. Staff WhatsApp copilot flow

```
Staff phone messages WhatsApp
  → Identity route: known staff phone → COPILOT pipeline (AgentSession by thread)
  → Deterministic CRM short-circuit ("visits today", "new leads today") → DB answer, no LLM
  → else workflow classifier (temp 0) → execute / clarify
  → else intent orchestrator (~50 intents: classify → extract → execute)
  → else LangGraph tool-calling agent (last resort)
  → destructive action? → PendingAction (awaiting) → staff confirms YES/NO → execute
  → every step logged in agent_action_logs
  → viewer role: read-only (no writes)
```

Dashboard parity: same backend via `POST /api/copilot/chat` rendered in `/copilot` chat UI.

---

## 6. Staff dashboard flows (by role)

### 6.1 Lead management

```
Leads list (filtered by role: agent sees assigned only)
  → filter/search (status, agent, date) → open Lead detail
  → Lead detail: profile, timeline, lead_memory panel ("what AI knows"), conversations, visits
  → actions: update status (FSM-validated), add note, assign agent, schedule visit
  → status change → notification + audit log
```

Lead status FSM (no skipping, terminal locked):
```
new → contacted → visit_scheduled → visited → negotiation → closed_won | closed_lost
                       │ (cancel) ↺ contacted
closed_lost → (admin only) → contacted
```

### 6.2 Property management & import

```
Properties page (company_admin)
  → manual CRUD  OR  Property Import wizard:
       Upload (PDF/Excel/CSV/images) → PropertyImportDraft (extraction_status pending_upload)
       → queue extraction (worker) → draft_data + units + media
       → review (mapping review, unit editor) → edit/accept/reject
       → publish → Property rows created (status available)
  → Bulk CSV/XLSX import → many properties at once
  → AI only reads PUBLISHED inventory
```

Draft status: `draft → extracting → review_ready → publish_ready → published` (or `failed`/`cancelled`).

### 6.3 Calendar / visits

```
Calendar (day/week/month)
  → book visit: pick lead, property, agent, datetime
      validate: not past, no agent double-book within 60 min
  → visit status updates → notifications (scheduled/confirmed/completed/cancelled/rescheduled)
  → reschedule/cancel → emits notification + (optional) WhatsApp to customer
```

### 6.4 Conversations center

```
Conversations list → open conversation
  → live transcript (customer/ai/agent color-coded), WebSocket updates
  → takeover toggle (→ agent_active) / release
  → internal notes
```

### 6.5 Analytics & finance

```
Analytics: funnel, daily trends, agent leaderboard, conversion, visit completion, AI stats
Billing: plan, invoices, payment status
EMI calculator: principal/rate/tenure → amortized breakdown
```

### 6.6 Super admin

```
Companies: create/deactivate, assign plan, set unique WhatsApp number
Audit logs: platform-wide write trail
(System monitoring: error logs, queue depth, AI usage, DB health)
```

---

## 7. System automation flows (CRON / async)

### 7.1 Visit reminders (every ~15 min)
```
scan visits where status in (scheduled, confirmed) and reminder windows hit
  → 24h before: WhatsApp to customer + agent notification
  → 1h before: WhatsApp to customer
  → 15min before: agent push notification
  → mark reminderSent
```

### 7.2 Follow-up automation
```
contacted + 48h idle → auto follow-up WhatsApp (re_engagement_sent_at / count guard prevents spam)
visit completed → next-day feedback follow-up
negotiation + 7d → agent reminder
```

### 7.3 Daily analytics aggregation (midnight CRON)
```
per company: count leads_generated, visits_scheduled/completed, deals_closed, revenue,
ai_conversations, ai_messages_sent → upsert analytics(company_id, date)
```

### 7.4 Property import worker
```
worker consumes property_import_jobs (extract_media)
  → OCR/parse → draft_data/units/media → status transitions → retries (max 3, next_retry_at)
```

---

## 8. Lead auto-creation flow (trigger detail)

```
Unknown WhatsApp number messages
  → create Lead (status=new, source=whatsapp, language=detected)
       @@unique([companyId, phone]) prevents duplicate on concurrent webhook retries
  → create Conversation (ai_active, stage=rapport)
  → assign agent (round-robin / least-loaded / manual per assignment-settings)
  → notify company admin (notification: lead_new)
  → AI begins conversation
```

---

## 9. Error & resilience flows

| Scenario | Handling |
|----------|----------|
| Duplicate webhook | Dedup table + Redis lock → ignore second |
| Double booking tap | Idempotency key → one visit, cached reply |
| Workflow step failure | Saga compensates in reverse OR `needs_reconciliation` + admin alert |
| LLM provider down | Provider fallback chain → safe fallback message (no invented outage) |
| Banned phrase in output | Replaced with safe, stage-aware fallback |
| AI during takeover | Suppressed (H1 terminal) |
| Rate limit exceeded | 429 with retry; per-user/company/AI limiters |

---

## 10. State machines summary

**Lead:** `new → contacted → visit_scheduled → visited → negotiation → closed_won|closed_lost`
**Visit:** `scheduled → confirmed → completed|cancelled|no_show`
**Conversation:** `ai_active ⇄ agent_active → closed`
**Conversation stage:** `rapport → qualify → shortlist → objection_handling → commitment → visit_booking → confirmation → (closed_won|human_escalated|closed_lost)`
**Pending action:** `awaiting → confirmed|rejected|expired`
**Import draft:** `draft → extracting → review_ready → publish_ready → published` (`failed`/`cancelled`)
**Workflow run:** `running → completed|failed|completed_with_errors|needs_reconciliation`
