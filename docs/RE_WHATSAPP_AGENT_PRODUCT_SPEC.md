# Real Estate WhatsApp AI Agent — Product Specification (PO / FDE)

**Document role:** Product Owner + Forward Deployed Engineer view  
**Audience:** Founders, clients, engineering, implementation partners  
**Rule:** If it is not written here (or linked child spec), it is **not built**. No guessing. No “common sense.”

---

## How money is made (market reality)

### Who pays

| Buyer | Why they pay | Typical ACV (India, 2026) | Churn driver |
|-------|----------------|---------------------------|--------------|
| **Real estate developer** | Missed WhatsApp leads = lost crores in inventory | ₹15k–₹2L+/mo | AI says wrong price / no site visits booked |
| **Brokerage / channel partner** | Agents slow on WhatsApp; leads go to competitor | ₹3k–₹25k/mo | Agents bypass system |
| **Property marketing agency** | Runs ads → WhatsApp; needs qual + handoff | ₹5k–₹50k/mo | No portal integration |
| **PropTech reseller / FDE** | White-label to 10–50 agencies | Revenue share | Support cost > margin |

### Revenue models (pick one per deployment — must be specified)

| Model | How money flows | What product must prove |
|-------|-----------------|-------------------------|
| **SaaS subscription** | Per company / per agent seat / per WhatsApp number | MRR, onboarding < 7 days |
| **Per qualified lead** | Charge per Hot lead or per site visit booked | Auditable lead score + visit record |
| **Per conversation / message** | Pass-through Meta costs + margin | Metering, caps, invoices |
| **Setup + retainer** | FDE implements; monthly ops fee | SOW tied to this spec |
| **Hybrid** | Base fee + overage on AI tokens or messages | Usage dashboard |

### What actually sells (not features — outcomes)

1. **Reply in &lt; 60 seconds** on WhatsApp (5-minute rule kills deals).  
2. **Site visit booked** without human typing first message.  
3. **Agent shows up prepared** (budget, location, project, language on screen).  
4. **No wrong inventory** (RERA, price, availability).  
5. **Follow-up until dead or converted** (48h, pre-visit, post-visit).

**If the spec does not define how each outcome is measured, the product cannot be sold honestly.**

---

## The hospital analogy (mapped to this product)

| Hospital role | This product |
|---------------|--------------|
| **Hospital** | RE WhatsApp AI platform (one deployment per client or multi-tenant SaaS) |
| **Outbuildings** | Channels (WhatsApp primary; optional web widget, SMS later) |
| **Departments** | Lead CRM, Conversation engine, Property catalog, Visits/calendar, Agent workforce, Automation, Admin/billing |
| **Rooms** | Screens + flows (customer chat, agent inbox, admin config, super-admin if SaaS) |
| **Equipment** | APIs (Meta Cloud API, LLM, DB, calendar, storage, email) |
| **Specifications** | Every field, button, state, message, permission in sections below |

**Developer = construction crew.** They pour concrete exactly as drawn.  
**PO / FDE = architect who must draw every room and every bolt.**

---

## Level 1 — The building (product boundary)

**Client statement (example):** “Build a WhatsApp AI that replaces our sales rep for flats and projects.”

**PO must lock:**

| # | Decision | Options (pick one) | Default if silent |
|---|----------|-------------------|-------------------|
| L1-01 | **Deployment model** | Single agency self-host / Multi-tenant SaaS / FDE-managed instance | **Nothing built** |
| L1-02 | **Geography & language** | Cities served; languages (e.g. EN, HI, KN only) | **Nothing built** |
| L1-03 | **Inventory type** | Apartments, villas, plots, commercial | **Nothing built** |
| L1-04 | **Transaction type** | Buy / rent / both / invest | **Nothing built** |
| L1-05 | **WhatsApp provider** | Meta Cloud API only / BSP (Wati, Gallabox, etc.) / Unofficial (Baileys) — **must be explicit** | **Nothing built** |
| L1-06 | **Human replacement scope** | 24/7 first response only / Full qual + visit / Through negotiation | **Nothing built** |
| L1-07 | **CRM source of truth** | Built-in CRM / HubSpot / Zoho / Sell.Do / Sheets | **Nothing built** |
| L1-08 | **Success metric (primary)** | Visits booked / Qualified leads / Revenue attributed | **Nothing built** |

---

## Level 2 — Departments (modules)

Each department is a **separate sub-spec** (linked doc or appendix). Unspecified department = **stub or omitted**.

| Department ID | Name | Purpose | Money link |
|---------------|------|---------|------------|
| D01 | **WhatsApp ingress/egress** | Receive/send messages, media, templates, status | Without this, zero product |
| D02 | **AI conversation engine** | Qualify, recommend, persuade, extract intent | Core differentiator |
| D03 | **Property & project catalog** | Ground truth for AI answers | Wrong catalog = lawsuits + churn |
| D04 | **Lead & pipeline CRM** | Status, assignment, notes, history | Sales team adoption |
| D05 | **Visit & calendar** | Book, conflict-check, remind, complete | Primary conversion event |
| D06 | **Agent workforce** | Users, roles, load, notifications | Ops trust |
| D07 | **Automation & jobs** | Follow-ups, reminders, stale close | “AI never forgets” |
| D08 | **Admin & configuration** | AI tone, hours, FAQs, feature flags | Per-client customization |
| D09 | **Analytics & billing** | Usage, conversion, invoices (if SaaS) | Pricing enforcement |
| D10 | **Security & compliance** | Tenant isolation, audit, retention | Enterprise deals |

---

## Level 3 — Rooms (user-facing surfaces)

### Room: Customer WhatsApp chat (D01 + D02)

| Element | Must specify |
|---------|--------------|
| Entry | New number vs returning; opt-in text if required |
| Greeting | Exact copy per language; variables `{business_name}` |
| Qualification order | Budget → location → BHK → timeline OR other |
| Property presentation | Max count (2/3/5); format (text only / images / PDF / map pin) |
| Visit CTA | Exact prompts; button labels vs free text |
| Handoff phrase | When AI stops; exact customer message |
| After-hours | Exact message; AI on/off |
| Opt-out | Keywords (STOP); behavior after opt-out |
| Unsupported intents | Legal, loan guarantee, competitor bash — exact deflection copy |

### Room: Agent mobile/web inbox (D04 + D06)

| Element | Must specify |
|---------|--------------|
| Who sees which leads | Assigned only / team pool / admin all |
| Can agent reply on WhatsApp from dashboard | Yes/no; if yes, sender identity |
| Takeover | Button label; does AI pause automatically |
| Notifications | Push / email / WhatsApp to agent; triggers list |
| Read-only vs edit | Per role |

### Room: Calendar / visits (D05)

| Element | Must specify |
|---------|--------------|
| Views | Day / week / month; whose calendar |
| Create visit | Required fields; min notice (e.g. 2h); max horizon |
| Double-booking rule | Same agent overlap forbidden? buffer minutes |
| Reschedule/cancel | Who can; customer self-serve on WhatsApp? |
| Completion | Statuses; mandatory notes |

### Room: Property admin (D03)

| Element | Must specify |
|---------|--------------|
| CRUD fields | Every column name, type, validation |
| Statuses | available / sold / hold — transitions |
| Media limits | Max images; max PDF MB |
| Import | Excel mapping; human review yes/no |

### Room: Company admin / onboarding (D08)

| Element | Must specify |
|---------|--------------|
| Onboarding steps | Count; blocking vs skippable |
| AI config | Tone 1–10; persuasion; FAQ schema |
| WhatsApp connect | Meta embedded signup vs manual token |
| Team invite | Default password policy; email sent yes/no |

### Room: Super-admin (D09) — only if multi-tenant SaaS

| Element | Must specify |
|---------|--------------|
| Company CRUD | Fields; deactivate vs delete |
| Plans | Limits: agents, leads, messages, properties |
| Impersonation | Allowed yes/no |

---

## Level 4 — Components (exact specifications)

### Component: Inbound WhatsApp webhook (D01)

| Attribute | Specification (example — replace with client values) |
|-----------|------------------------------------------------------|
| Endpoint path | e.g. `POST /api/webhook/whatsapp` |
| Verification | `GET` challenge; `hub.verify_token` exact string |
| Signature | Header `X-Hub-Signature-256`; HMAC SHA256; reject if invalid in prod |
| Response time | HTTP 200 within **≤ 3s**; heavy work async |
| Idempotency | Dedupe key = `whatsapp_message_id`; duplicate → no second lead/message |
| Tenant resolution | By `phone_number_id` → `company_id`; failure behavior → drop + alert |
| Supported inbound types | `text`, `image`, `document`, `audio`, `button`, `interactive` — **list each** |
| Unsupported type | Exact auto-reply or ignore |

### Component: Lead record (D04)

| Field | Type | Required | Validation | Who can edit |
|-------|------|----------|------------|--------------|
| `phone` | E.164 string | Yes | `^\+[1-9]\d{1,14}$` | System |
| `customer_name` | string | No | max 255 | AI / agent / admin |
| `budget_min` | decimal | No | ≥ 0 | AI / agent |
| `budget_max` | decimal | No | ≥ budget_min | AI / agent |
| `location_preference` | string | No | max 255 | AI / agent |
| `property_type` | enum | No | `apartment \| villa \| plot \| commercial` | AI / agent |
| `intent` | enum | No | `buy \| rent \| invest` | AI / agent |
| `status` | enum | Yes | See state machine below | agent / admin |
| `assigned_agent_id` | UUID | No | must be active agent in company | system / admin |
| `language` | ISO 639-1 | No | from allowed list | AI |
| `source` | enum | Yes | `whatsapp \| manual \| portal` | system |
| `lead_score` | enum | No | `hot \| warm \| cold` | AI / rules |

**Lead status state machine (must match exactly):**

```
new → contacted → visit_scheduled → visited → negotiation → closed_won
                                                      └→ closed_lost
```

| Transition | Allowed | Actor | Side effect |
|------------|---------|-------|-------------|
| `new` → `contacted` | Yes | AI / agent | timestamp `last_contact_at` |
| `*` → `visit_scheduled` | Only if `visits` row exists | system | **must specify** |
| `closed_won` / `closed_lost` | Terminal | agent / admin | no auto reopen unless specified |

### Component: Visit record (D05)

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `lead_id` | UUID | Yes | exists, same company |
| `property_id` | UUID | No | exists, status = available |
| `agent_id` | UUID | Yes | active; assignment rules apply |
| `scheduled_at` | UTC datetime | Yes | not in past; min **X** hours ahead |
| `duration_minutes` | int | Yes | default **60** |
| `status` | enum | Yes | `scheduled \| confirmed \| completed \| cancelled \| no_show` |
| `notes` | text | No | max **2000** chars |

| Rule ID | Rule |
|---------|------|
| V-01 | No two visits same `agent_id` overlapping `scheduled_at` ± `duration` |
| V-02 | On create → WhatsApp confirmation message **exact template** |
| V-03 | Reminder T-24h and T-1h → **exact copy** per language |
| V-04 | On `completed` → lead status → `visited` (if specified) |

### Component: AI system prompt boundary (D02)

| Rule | Specification |
|------|---------------|
| Domain | Real estate only; off-topic → exact redirect script |
| Grounding | May only cite `property_id` from query; no invented units |
| Languages | List allowed; mixed-language policy |
| Tools / functions | `search_properties`, `update_lead`, `book_visit`, `request_human` — **each with JSON schema** |
| Confidence threshold | Update lead field only if score ≥ **X** |
| Max tokens / latency | p95 response **≤ 10s** or fallback message **exact text** |
| Provider | Primary LLM + fallback; API keys per tenant or global |

### Component: Agent assignment (D06)

| Method | Specification |
|--------|---------------|
| Algorithm | `round_robin \| least_loaded \| manual_only` |
| Pool | All `sales_agent` active users in company |
| On assign | Notification title/body exact strings |
| Reassign | Who can; notify old agent yes/no |

### Component: Follow-up automation (D07)

| Trigger | Delay | Channel | Exact message template | Stop condition |
|---------|-------|---------|------------------------|----------------|
| Lead `contacted`, no reply | 48h | WhatsApp | `{template_id}` | reply or opt-out |
| Visit `scheduled` | 24h before | WhatsApp | `{template_id}` | visit cancelled |
| Visit `scheduled` | 1h before | WhatsApp | `{template_id}` | — |
| Visit `completed` | 24h after | WhatsApp | `{template_id}` | — |
| `negotiation` idle | 7d | notify agent | in-app | — |

### Component: RBAC (D06 + D10)

| Role | leads.read | leads.write | visits.write | properties.write | ai_config | billing |
|------|------------|-------------|--------------|------------------|-----------|---------|
| super_admin | all tenants | all | all | all | all | all |
| company_admin | company | company | company | company | company | read |
| sales_agent | assigned | assigned | assigned | read | — | — |
| operations | company | read | read | read | — | — |
| viewer | company | — | — | read | — | — |

**Unlisted permission = denied.**

### Component: Error messages (sample — every API must have full table)

| Code | HTTP | User-visible message (EN) | Logged detail |
|------|------|---------------------------|---------------|
| `LEAD_NOT_FOUND` | 404 | "Lead not found." | yes, no PII in log |
| `VISIT_CONFLICT` | 409 | "This agent is already booked at that time." | agent_id, slot |
| `WHATSAPP_SEND_FAILED` | 502 | "Message could not be sent. We will retry." | Meta error code |

---

## Level 5 — Inside the machine (sub-components)

### ECG equivalent: `book_visit` tool (D02 → D05)

| Sub-component | Specification |
|---------------|---------------|
| Input schema | `{ property_id?, preferred_date, preferred_slot, customer_notes? }` |
| Calendar check | Query agent availability API; return slots if conflict |
| DB write | `INSERT visits` + `UPDATE leads.status` in **one transaction** |
| Rollback | If WhatsApp send fails after DB commit → **specify**: retry queue / manual alert |
| Confirmation message | Variables: `{property_name}`, `{date}`, `{time}`, `{agent_name}`, `{map_link}` |
| Failure to customer | Exact string when no slots |

### Battery equivalent: Message queue job

| Attribute | Value |
|-----------|-------|
| Queue name | `whatsapp_outbound` |
| Max attempts | 3 |
| Backoff | exponential 1s, 4s, 16s |
| DLQ | yes; admin replay UI yes/no |
| Idempotency key | `outbound:{message_id}` |

### Screen equivalent: WhatsApp template message

| Template name | Language | Category | Body text | Buttons |
|---------------|----------|----------|-----------|---------|
| `visit_reminder_24h` | en | UTILITY | "Hi {{1}}, reminder..." | none |
| | hi | UTILITY | **exact Hindi** | |

**Meta approval status** must be tracked per template.

### WiFi equivalent: Tenant isolation

| Check | Specification |
|-------|---------------|
| Every query | `WHERE company_id = :authenticated_company_id` |
| JWT claims | `{ user_id, company_id, role }` — client cannot override `company_id` |
| Test | Negative test: user A cannot read user B lead → **required before prod** |

---

## FDE delivery checklist (money protection)

Before go-live with a paying client:

- [ ] Meta WhatsApp number live; webhook verified in **production** URL  
- [ ] One end-to-end test: unknown number → qual → property match → **visit row in DB** → agent notification → reminder fired  
- [ ] Inventory sheet signed by client (“AI may only speak from this data”)  
- [ ] Languages tested with 10 real utterances each  
- [ ] Opt-out and working-hours tested  
- [ ] Support contact when AI hands off  
- [ ] Usage/billing meter defined (if charging per message/lead)  
- [ ] Data retention days: **\_\_\_** ; export on request: yes/no  

---

## Spec completeness gate (PO sign-off)

| Level | Question | Signed by | Date |
|-------|----------|-----------|------|
| 1 | Building boundary locked? | | |
| 2 | All departments in scope listed? | | |
| 3 | All rooms/screens listed? | | |
| 4 | All components have tables above filled? | | |
| 5 | Sub-components (tools, queue, templates) filled? | | |

**Developer acknowledgment:**

> If you don’t specify it, I will not implement it. I will not guess. I will not assume. I will not use “common sense.” Give me every page, every button, every color, every font, every API, every field, every validation rule, every error message, every permission, every state — like a recipe with no missing steps. I follow and build.

| Role | Name | Signature |
|------|------|-----------|
| Product Owner | | |
| Client / Agency | | |
| Tech lead | | |

---

## Appendix A — Child documents to create (when scope grows)

| Doc ID | Title | Owns |
|--------|-------|------|
| SPEC-D01 | WhatsApp Meta integration | Webhooks, templates, media |
| SPEC-D02 | AI engine & prompts | Tools, languages, grounding |
| SPEC-D03 | Property catalog & import | Schema, OCR, review queue |
| SPEC-D04-D06 | CRM, visits, agents | This doc sections expanded |
| SPEC-D07 | Automation cron/queue | All triggers |
| SPEC-D09 | Pricing & metering | Plans, limits, invoices |

---

## Appendix B — What NOT to claim until specified AND tested

- “Replaces 100% of human chats”  
- “Enterprise-ready” without tenant isolation tests  
- “Calendar integrated” without `visits` DB + conflict rules  
- “11 languages” without per-language copy deck  
- “Sends brochures on WhatsApp” without media send + approved templates  

---

**Version:** 1.0.0  
**Status:** Template — fill every `{placeholder}` before build  
**Owner:** Product / FDE
