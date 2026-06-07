# Investo — Product Requirements Document (PRD)

> **Multi-tenant, multi-language real estate CRM with a WhatsApp AI agent that converses in every major Indian language, qualifies buyers, recommends matching inventory, and closes site visits.**

| Field | Value |
|-------|-------|
| Product | Investo — Real Estate AI SaaS Platform |
| Version | 0.1.10 (`v0.1.10-ai-ops-bible`) |
| Document | Product Requirements Document |
| Status | Production (biginvesto.online) |
| Last updated | 2026-06-07 |

---

## 1. Overview

### 1.1 Problem statement
~78% of Indian real estate inquiries begin on WhatsApp, in dozens of languages, often after business hours. A typical sales agent handles ~30 leads and cannot reply instantly, in the buyer's language, 24/7. Leads go cold, follow-ups are missed, and inventory data is scattered across brochures, Excel sheets, and WhatsApp chats.

### 1.2 Product vision
A customer messages on WhatsApp in **any Indian language**. The AI replies in the **same language**, understands their budget, location, and BHK preferences, recommends matching properties from the company's approved inventory, handles objections, and **persuades them to book a site visit** — all while staying strictly within the real estate domain. Real estate companies manage everything through a responsive web dashboard. Each company's data is fully isolated (multi-tenant).

### 1.3 Core promise
> One AI agent replaces the always-on first line of a sales team — instant, multilingual, persuasive, and never off-topic — and books site visits without human intervention for the majority of inbound conversations.

### 1.4 Non-goals
- **No native mobile app** — responsive web only (HD-4).
- **No general-purpose chatbot** — the AI is wired exclusively for real estate and refuses off-topic discussion.
- **No autonomous pricing/negotiation** — price negotiation escalates to a human.

---

## 2. Target users & personas

| Persona | Role | Primary need |
|---------|------|--------------|
| **Platform Operator** | `super_admin` | Manage tenants, plans, billing, platform health |
| **Company Owner/Admin** | `company_admin` | Configure AI, manage team, see analytics, own all company data |
| **Sales Agent** | `sales_agent` | Work assigned leads, take over conversations, manage own calendar |
| **Operations/Support** | `operations` | Coordinate visits, monitor conversations |
| **Manager/Analyst** | `viewer` | Read-only access to leads, analytics, conversations |
| **Buyer (end customer)** | none (WhatsApp only) | Find a property and book a visit in their own language |

### Market served
1. Real estate developers automating WhatsApp lead handling.
2. Real estate agencies managing multiple projects and agents.
3. Property brokers converting leads without a large sales team.

---

## 3. Goals & success metrics

| Goal | Metric | Target |
|------|--------|--------|
| Instant response | AI response latency | < 10 s (p95) |
| Convert chats to visits | Visit booking rate vs manual | ~3× manual baseline |
| Language coverage | Supported Indian languages | 11+ |
| Reliability | System uptime | 99.5% |
| Webhook compliance | Meta webhook ACK time | 200 within 5 s |
| Multi-tenant safety | Cross-tenant data leaks | 0 |
| Conversation containment | Conversations AI resolves without human | majority of first-contact chats |

---

## 4. Product layer model

| Layer | Scope |
|-------|-------|
| **L1 Core** | WhatsApp AI conversation, property matching, site visit booking |
| **L2 Infrastructure** | Auth (JWT + refresh), multi-tenant isolation, WhatsApp Cloud API, AI providers, encryption, backups, health checks |
| **L3 Usability** | Role dashboards, lead CRM, property management, conversation center, calendar, agent management, onboarding wizard |
| **L4 Comfort** | Notifications, search/filters, analytics, lead scoring, follow-up reminders, bulk ops |
| **L5 Delight** | AI tone learning, smart suggestions, predictive scoring, quick replies, automated follow-up sequences |
| **L6 Trust** | Audit logs, RBAC, privacy controls, encryption, compliance, rate limiting, AI action transparency logs |

---

## 5. Functional requirements

### 5.1 WhatsApp AI agent (buyer)
- **FR-AI-1** Detect inbound language and respond in the same language (11+ languages, incl. Hinglish/mixed).
- **FR-AI-2** Stay strictly within real estate; refuse and redirect off-topic queries.
- **FR-AI-3** Run a goal-directed conversation funnel: `rapport → qualify → shortlist → objection_handling → commitment → visit_booking → confirmation`.
- **FR-AI-4** Collect budget, location preference, property type, timeline; persist into unified lead memory.
- **FR-AI-5** Query the company's **approved** inventory and recommend 2–3 matches; never invent facts (prices, RERA, amenities) not in the data.
- **FR-AI-6** Handle objections (price, family, just-looking, location, timing, competitor, trust) using playbooks.
- **FR-AI-7** Book a site visit via chat or interactive buttons; create/confirm a `visit` record.
- **FR-AI-8** Send exactly **one** outbound payload per inbound message (text or one interactive message + optional media). No multi-reply syndrome.
- **FR-AI-9** Escalate to a human on explicit request, price negotiation, or repeated unresolved objections; AI disengages while a human is active.
- **FR-AI-10** Support interactive elements: quick-reply buttons (Book Visit, Call Me, Property Details, EMI), time-slot buttons, list pickers, location pins.
- **FR-AI-11** Send rich media: property images, brochure PDFs, floor plans, price lists, location pins (from approved assets).
- **FR-AI-12** Idempotent mutations: a duplicate booking request (webhook retry/double-tap) produces one visit, not two.

### 5.2 Staff WhatsApp copilot
- **FR-ST-1** Staff phone numbers route to a copilot (not the buyer funnel).
- **FR-ST-2** Deterministic CRM commands ("visits today", "new leads today") answered without LLM where possible.
- **FR-ST-3** ~50 staff intents: classify → extract → execute (with confirmation for destructive actions).
- **FR-ST-4** LangGraph tool-calling agent as last-resort fallback.
- **FR-ST-5** `viewer` role gets a read-only copilot (no writes).

### 5.3 Lead management (CRM)
- **FR-LD-1** Auto-create a lead when an unknown WhatsApp number messages (status `new`).
- **FR-LD-2** Fields: name, phone (E.164), email, budget range, location, property type, source, status, assigned agent, notes, language, metadata, lead memory.
- **FR-LD-3** Status state machine enforced: `new → contacted → visit_scheduled → visited → negotiation → closed_won|closed_lost` (no skipping; terminal states locked; only admin reopens).
- **FR-LD-4** Search, filter (status/agent/date), bulk assign, CSV export (role-gated), lead timeline.
- **FR-LD-5** Lead assignment: round-robin, least-loaded, or manual.
- **FR-LD-6** Leads are never hard-deleted (close as lost only); GDPR delete is a controlled operation.

### 5.4 Property management & ingestion
- **FR-PR-1** CRUD for properties: name, builder, location (city/area/pincode), price range, bedrooms, type, amenities, description, images, brochure, floor plans, price list, lat/long, RERA, status.
- **FR-PR-2** Group properties under projects.
- **FR-PR-3** Property import pipeline: upload (PDF/Excel/CSV/images) → extraction draft → human review → publish. Bulk CSV/XLSX import supported.
- **FR-PR-4** Human-in-the-loop review before customer-facing publish; confidence-scored drafts.
- **FR-PR-5** AI answers only from published/approved inventory.

### 5.5 Visits & calendar
- **FR-VS-1** CRUD visits with status machine: `scheduled → confirmed → completed|cancelled|no_show`.
- **FR-VS-2** No past-dated visits; no double-booking an agent within 60 minutes.
- **FR-VS-3** Reminders: 24 h and 1 h before (customer WhatsApp), 15 min before (agent).
- **FR-VS-4** Pending-approval flow: agent confirms a buyer-requested slot via interactive button (unless `autoConfirmVisits` is on).

### 5.6 Conversations
- **FR-CV-1** Conversation center shows all chats with AI/agent/customer messages color-coded.
- **FR-CV-2** Real-time updates via WebSocket.
- **FR-CV-3** Agent takeover toggles conversation to `agent_active`; AI stops sending.
- **FR-CV-4** Conversation status machine: `ai_active → agent_active → closed` (with release back to AI).

### 5.7 AI configuration
- **FR-CF-1** Per-company AI settings: business name/description, operating areas, budget ranges, tone (formal/friendly/casual), working hours, FAQ knowledge, greeting template, persuasion level (1–10), language defaults, agent persona name.
- **FR-CF-2** "Never-Say-No" conversion brain: business type, partner referrals, special offers, conversion rules, fractional/rent-to-own toggles, budget stretch %.

### 5.8 Onboarding & dynamic configuration
- **FR-ON-1** Six-step onboarding wizard: profile → roles → features → AI config → invite team → complete.
- **FR-ON-2** Custom roles per company with JSON permission maps (dynamic RBAC).
- **FR-ON-3** Feature flags per company (e.g., `ai_bot`, analytics, visit scheduling).

### 5.9 Analytics & finance
- **FR-AN-1** Dashboards: lead funnel, daily trends, agent leaderboard, conversion, visit completion, AI conversation stats.
- **FR-AN-2** Daily analytics aggregation (CRON).
- **FR-FN-1** Subscription plans, invoices, billing status.
- **FR-FN-2** EMI calculator (endpoint + UI).

### 5.10 Platform administration (super admin)
- **FR-SA-1** Company CRUD (deactivate, never delete), plan assignment, unique WhatsApp number.
- **FR-SA-2** System monitoring: error logs, queue depth, AI usage, DB health.
- **FR-SA-3** AI action logs and per-lead memory transparency panels.

---

## 6. Non-functional requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | API < 500 ms p95; webhook processing < 3 s; AI < 10 s; dashboard load < 2 s |
| **Availability** | 99.5% uptime; webhook 200 within 5 s |
| **Scalability** | 100+ companies; 10,000+ concurrent conversations; indexed queries < 100 ms |
| **Security** | JWT 24 h / refresh 7 d; bcrypt ≥ 12 rounds; TLS everywhere; rate limits (100/min user, 1000/min company); webhook signature verification; CORS allow-list |
| **Data integrity** | Money as DECIMAL; timestamps UTC; phones E.164; UUID PKs |
| **Privacy/compliance** | Per-tenant isolation; audit logs; data export; GDPR delete; 90-day retention after deactivation |
| **Determinism** | Buyer LLM temperature 0; structured JSON output; safe-param wrapper on every buyer LLM call |
| **Observability** | Every autonomous action in `agent_action_logs`; ops metrics; health/readiness endpoints |

---

## 7. Constraints & hard decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| HD-1 | Shared DB with `company_id` on every table | Simpler ops; enforce isolation at app layer |
| HD-2 | Multi-provider AI (OpenAI/Kimi/Claude with fallback) | Resilience + Indian-language quality |
| HD-3 | Meta WhatsApp Cloud API (official) | Reliable, compliant, scalable |
| HD-4 | Responsive web, no native app | Single codebase, instant updates |
| HD-5 | AI-first, manual agent takeover | AI handles majority; humans for edge cases |
| HD-6 | Dynamic per-message language | Buyers switch languages mid-chat |

---

## 8. What is forbidden (product guardrails)

- Cross-tenant data access (every query must filter `company_id`).
- AI discussing non-real-estate topics or inventing prices/availability.
- AI sending messages while a conversation is `agent_active`.
- Multiple separate outbound messages for a single inbound message.
- Hard-deleting companies or leads.
- Past-dated visits or double-booked agents.
- Skipping lead pipeline statuses.
- Plain-text passwords; logging secrets/full phone numbers.

---

## 9. Assumptions & dependencies

- **Meta WhatsApp Cloud API** access with verified business numbers per tenant.
- **AI provider keys** (OpenAI primary; Kimi/Claude fallback).
- **PostgreSQL (Neon/Supabase)** with `pgvector` and `uuid-ossp` extensions.
- **Redis (Upstash)** for cache/locks/queues (memory fallback if unavailable).
- **S3-compatible storage** for media/brochures.
- Buyers reachable on WhatsApp; tenants maintain approved inventory.

---

## 10. Release scope & phasing

| Phase | Scope |
|-------|-------|
| **MVP (shipped)** | Auth, multi-tenant CRM, properties, WhatsApp buyer AI, visit booking, dashboard, onboarding, analytics, staff copilot, action logs |
| **Phase 2** | Excel/CSV mapping per company, OCR extraction, draft confidence + review queue |
| **Phase 3** | Full WhatsApp rich-media + interactive webhook handling, stage-aware media selection |
| **Phase 4** | EMI deep flows, price versioning/offer windows, conversion-by-media analytics, LLM-driven proactive follow-ups |

---

## 11. Open questions

1. Is Excel the single pricing source of truth per company, or one of several inputs?
2. When brochure, Excel, and admin edits disagree, which wins?
3. How long can a price stay active before considered stale?
4. Which fields may auto-publish vs always require human review?
5. Final product decision on takeover semantics when a buyer messages mid-takeover.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **Tenant / Company** | A real estate business using Investo; data-isolated |
| **Buyer** | End customer messaging on WhatsApp (no dashboard account) |
| **Staff** | Internal users (admin/agent/ops/viewer) |
| **Lead memory** | Unified per-lead JSON brain (budget, projects discussed, summary) |
| **Workflow** | A CRM mutation/query unit (15 workflows, 45+ actions) |
| **Saga** | Atomic multi-step workflow with compensating rollback |
| **Zero-UI** | Staff/buyers operating fully through WhatsApp without the dashboard |
| **Never-Say-No** | Conversion brain offering alternatives instead of dead-ends |
