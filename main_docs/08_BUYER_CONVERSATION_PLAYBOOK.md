# Investo — Buyer Conversation Playbook (Zero-UI WhatsApp)

| Field | Value |
|-------|-------|
| Document | Buyer conversation scripts — from first “Hi” through booking |
| Audience | Sales, QA, product, backend engineers |
| Source | `buyerQualification.service.ts`, `whatsappTurnOrchestrator.service.ts`, `whatsappInteractiveOrchestrator.service.ts`, `visitPendingApproval.service.ts`, `callRequest.service.ts` |
| Related | [07_AIAGENT_FLOW.md](./07_AIAGENT_FLOW.md), [03_APP_FLOW.md](./03_APP_FLOW.md) §4 |
| Last updated | 2026-06-08 |

Every section lists three perspectives:

- **Client** — what the buyer sees on WhatsApp  
- **Agent (Investo user)** — notifications / WhatsApp copilot / manual actions  
- **Dashboard** — DB + real-time UI updates  

---

## 0. Before any message (system)

| Actor | What happens |
|-------|----------------|
| **System** | Meta delivers webhook → `POST /api/webhook` (signature or E2E token) → ACK 200 |
| **System** | Unknown phone → **Buyer AI** (not staff copilot) |
| **System** | Auto-create `Lead` (`status=new`) + `Conversation` (`status=ai_active`, `stage=rapport`) |
| **Dashboard** | `lead:created` socket; lead appears in pipeline |
| **Agent** | Optional: `lead_new` notification if round-robin assigned |

---

## 1. Opening conversation — “Hi”, “Hello”, “Hey”

**Handler:** H2 Rapport (deterministic — **no LLM** for bare greetings)  
**Stage:** `rapport`  
**E2E:** `buyer-01-rapport`

### 1.1 First-time buyer (no prior AI messages)

**Client sends:** `Hi` / `Hello` / `Hey` / `Good morning`

**Client receives (text):**
```
Hello! Welcome to *{CompanyName}*.

I can help you explore homes in Bangalore — share your budget, preferred area, and BHK,
or ask about a specific project.
```

**Client receives (buttons — rapport stage):**

| Button ID | Label |
|-----------|-------|
| `filter-apartment` | 🏢 Apartments |
| `filter-villa` | 🏡 Villas |
| `call-me` | 📞 Call Me |

**Agent:** No alert for a bare greeting (unless new lead assignment).

**Dashboard:**

| Field | Value |
|-------|-------|
| `conversation.stage` | `rapport` |
| `conversation.status` | `ai_active` |
| Messages | Inbound `customer`, outbound `ai` |
| Socket | `conversation:updated`, `message:new` |

### 1.2 Returning buyer (prior AI/staff messages exist)

**Client sends:** `Hi` again

**Client receives (text only — no filter buttons):**
```
Welcome back! Still looking at *{saved area}*, or something new?
```
(or “Still exploring options, or something new?” if no area saved)

**Handler:** H2b if they reply `Something new` / `Start fresh` → pivot reply asking budget/area/BHK.

**Agent / Dashboard:** Same conversation thread; no new lead.

### 1.3 Greeting + intent in one message

**Examples:** `Hi I'm looking for 3BHK in Whitefield`

**Handler:** H2 may match, or message falls through to **H4 qualification** / **H9 LLM** if budget/location detected.

**Client:** Welcome + acknowledgment of 3BHK/Whitefield; may advance stage toward `qualify` / `shortlist`.

---

## 2. Qualification — budget, area, BHK

**Handler:** H4 (deterministic ack) or H9 (LLM)  
**Stage:** `qualify` → `shortlist`  
**E2E:** `buyer-02-qualify`

**Client sends:** `Budget 1.2 to 1.5 crore, Whitefield, 3BHK`

**Client receives:**
```
Thanks — I've saved budget *₹1.20 crore – ₹1.50 crore* and area *Whitefield*.

Would you like to see matching projects, get a brochure, or book a free site visit?
```

**Buttons (qualify stage):** `filter-apartment`, `filter-villa`, `filter-plot`

**Agent:** None required.

**Dashboard:**

| Update | Detail |
|--------|--------|
| `lead.leadMemory` / fields | `budgetMin`, `budgetMax`, `locationPreference`, `propertyType` |
| RAG | `syncLeadClientMemory` (async) |
| Stage | Often `qualify` or `shortlist` |

---

## 3. Interactive — filter shortlist

**Handler:** Interactive orchestrator → `handlePropertyFilter`  
**Stage:** → `shortlist`  
**E2E:** `buyer-int-filter` (tap `filter-2bhk`)

**Client taps:** `filter-2bhk` (or sends filter via list)

**Client receives:** Property list matching filter (names, prices, interactive list / buttons per property)

**Supported filter IDs:**

| ID | Meaning |
|----|---------|
| `filter-1bhk` … `filter-5bhk` | Bedroom count |
| `filter-apartment` | Property type |
| `filter-villa` | Property type |
| `filter-plot` | Property type |
| `filter-commercial` | Property type |

**Agent:** None.

**Dashboard:**

| Update | Detail |
|--------|--------|
| `lead.notes` | e.g. `Prefers 2 BHK` |
| `conversation.stage` | `shortlist` |
| `conversation.recommendedPropertyIds` | Shortlist IDs |

---

## 4. Property details — “How much?” / More Info button

**Handler:** H7 `price_inquiry` or interactive `more-info-{propertyId}`  
**E2E:** `buyer-04-price`, `buyer-int-more-info`

**Client sends:** `What's the price for Sunset Heights?`  
**Or taps:** `more-info-{uuid}`

**Client receives:** Price, type, location, amenities summary (RAG + DB — no fabricated numbers)

**Agent:** `notifyIfHot` if lead score crosses threshold (optional).

**Dashboard:** Lead score may increase; `selectedPropertyId` may update.

---

## 5. Brochure request

**Handler:** H7 `brochure_request`  
**E2E:** `buyer-03-brochure`

**Client sends:** `Send brochure for Sunset Heights`

**Client receives:** PDF/image via WhatsApp media if `brochureUrl` exists; otherwise polite “no digital brochure” + offer to book visit.

**Dashboard:** Brochure request logged; score bump.

---

## 6. Call Me — callback booking (approval-first)

**Handler:** Interactive `call-me` → `scheduleCallRequest` → agent approval  
**E2E:** `buyer-int-call-me`

### 6.1 Client taps “Call Me”

**Client receives:**
```
*Callback request sent*

When: {parsed time or default slot}
Agent: *{AgentName}*

Our specialist will confirm the call time with you shortly.
```
Plus buttons: `call-reschedule`, `call-cancel`, `call-me`

**Agent receives:**

| Channel | Content |
|---------|---------|
| In-app | `call_requested` — “Callback approval needed” |
| WhatsApp | Interactive **Approve** / **Decline** (`call-approve-{callId}` / `call-decline-{callId}`) |

**Dashboard:**

| Update | Detail |
|--------|--------|
| `call_requests` row | `status=pending_approval` |
| Socket | `call:created` |

### 6.2 Agent approves call

**Client receives:**
```
✅ *Callback confirmed!*

📞 {date/time IST}
👤 Your specialist: *{AgentName}*

We'll call you at the scheduled time. Reply if you need to reschedule.
```

**Dashboard:** `call_requests.status=confirmed`; `call:updated`; `call_reminder_1h` job scheduled (>70 min before call).

### 6.3 Agent declines

**Client receives:** Ask for another time slot.

---

## 7. Site visit booking (approval-first) — your core flow

**Handlers:** H6 visit commit, interactive `book-visit-{propertyId}`, `visit-time-{propertyId}-{slot}`  
**E2E:** `buyer-06-book`, `buyer-int-book-visit`

### 7.1 Client expresses visit intent

**Client sends:** `Book me a site visit on Tuesday 5pm`  
**Or taps:** `book-visit-{propertyId}` → then slot button e.g. `visit-time-{pid}-tomorrow-10am`

**Client receives (pending approval — default `autoConfirmVisits=false`):**
```
Thanks! I've shared your preferred visit time with our sales specialist *{AgentName}*.
They'll confirm shortly on WhatsApp.
```

**Agent receives:**

| Channel | Content |
|---------|---------|
| In-app | `visit_scheduled` — “Site visit needs your approval” |
| WhatsApp | **Confirm visit** / **Decline** (`visit-approve-{approvalId}` / `visit-decline-{approvalId}`) |

**Dashboard:**

| Update | Detail |
|--------|--------|
| `booking_approval_requests` | `kind=visit`, `status=pending` |
| Lead | Still `contacted` / prior status until confirm |
| Calendar | **No visit row yet** until agent confirms |

### 7.2 Agent taps Confirm

**Client receives:**
```
*Visit confirmed!*

*{PropertyName}* - {Area}
{Tuesday, date}
{5:00 PM}
Your host: *{AgentName}*

See you at the site. Reply if you need help from the team.
```

**Agent receives:** WhatsApp ack: “Visit confirmed… calendar synced.”

**Dashboard:**

| Update | Detail |
|--------|--------|
| `visits` row | `status=confirmed`, `scheduledAt`, agent, property |
| `lead.status` | `visit_scheduled` |
| `conversation.stage` | `confirmation` |
| Sockets | `visit:created` or `visit:updated`, `lead:updated` |
| Reminders queued | `visit_reminder_24h`, `visit_reminder_1h` (client WhatsApp) |
| Agent reminder | ~15 min before: in-app “Visit in 15 minutes” |

### 7.3 Agent taps Decline

**Client receives:** Ask for another date/time; may get slot buttons again.

**Dashboard:** Approval `declined`; no visit row.

### 7.4 Pending-only reschedule / cancel (before agent confirm)

| Client action | Result |
|---------------|--------|
| New time while pending | Updates pending approval; agent gets fresh buttons |
| Cancel while pending | Pending cleared; agent notified on WhatsApp |

**No calendar change** until confirmed.

### 7.5 After confirmed — change request

**Client sends:** `Reschedule my visit to Sunday`

**Handler:** Notifies agent (`notifyAgentVisitChangeRequested`); agent/staff runs reschedule workflow or dashboard action.

---

## 8. Visit reminders (automated)

| Timing | Client | Agent |
|--------|--------|-------|
| 24h before | WhatsApp reminder + YES/RESCHEDULE hint | — |
| 1h before | WhatsApp “visit in 1 hour” | — |
| ~15m before | — | In-app notification |

Only fires when `visits.status = confirmed`.

---

## 9. Escalation vs takeover (different semantics)

### 9.1 Escalation (client asks for human / price negotiation)

**Client sends:** `I want to talk to a human` / `Give me 10% discount`

**Client receives:** “I've notified our team… I'm still here to help…”

**Agent receives:** Urgent alert + optional WhatsApp.

**Dashboard:**

| Field | Value |
|-------|-------|
| `conversation.status` | **`ai_active`** (AI keeps replying) |
| Audit | `workflow_escalate_to_human` or `buyer_ai_agent_assist` |

**E2E:** `buyer-11-escalate`, `buyer-12-no-discount`

### 9.2 Takeover (agent takes control from dashboard)

**Agent:** Dashboard → Take over conversation

**Client next message:** H1 handoff — “Our team has your request…”

**Dashboard:** `agent_active`, `aiEnabled=false`

**Release:** Dashboard “Release to AI” or buyer sends `/start` → AI resumes.

**E2E:** `system-takeover-blocks-ai`, `system-takeover-release`

---

## 10. Dismissal / soft close

**Client sends:** `No thanks`, `Ok`, `Got it` (after prior AI reply)

**Handler:** H1b — short ack, no push.

**Agent / Dashboard:** No change.

---

## 11. Staff WhatsApp (same phone = copilot, not buyer)

If the sender’s phone matches a company **User**, they never hit H2–H9 buyer flow.

**Examples:**

| Staff message | Response surface |
|---------------|------------------|
| `Visits today` | Staff copilot — CRM list |
| `New leads today` | Staff copilot |
| Tap `visit-approve-{id}` | Visit approval handler |
| Tap `call-approve-{id}` | Call approval handler |

See [07_AIAGENT_FLOW.md](./07_AIAGENT_FLOW.md) §5.

---

## 12. Conversation stage map (reference)

```
rapport → qualify → shortlist → objection_handling → commitment
                                      ↓
                              visit_booking → confirmation → closed_won
```

**Restart:** Buyer sends `/start` → H-start clears booking state, re-enables AI.

---

## 13. QA — E2E scenario map

| Playbook section | E2E scenario ID |
|------------------|-----------------|
| §1 Hi / Hello | `buyer-01-rapport` |
| §2 Qualify | `buyer-02-qualify` |
| §5 Brochure | `buyer-03-brochure` |
| §4 Price | `buyer-04-price` |
| §6 Call Me button | `buyer-int-call-me` |
| §3 Filter 2BHK | `buyer-int-filter` |
| §4 More info button | `buyer-int-more-info` |
| §7 Book visit button | `buyer-int-book-visit` |
| §7 Text book visit | `buyer-06-book` |
| §7 Idempotency | `buyer-07-idempotent` |
| §9 Escalation | `buyer-11-escalate` |
| §9 Takeover | `system-takeover-blocks-ai`, `system-takeover-release` |

Run full proof:
```bash
cd backend
npx tsx scripts/e2e-handset-proof.mjs
```

---

## 14. Configuration knobs (company / AI settings)

| Setting | Effect on conversation |
|---------|------------------------|
| `autoConfirmVisits=true` | Skips agent approval; visit row created immediately (rare in prod) |
| `ai_settings.operatorContact` | Appended to H1 handoff message |
| Company inventory | Empty catalog → “never say no” alternatives or honest empty state |
| Assigned agent | Round-robin on new lead; approval buttons go to assigned agent’s WhatsApp |

---

*This playbook is the operational source of truth for buyer-facing behavior. Architecture details remain in [07_AIAGENT_FLOW.md](./07_AIAGENT_FLOW.md).*
