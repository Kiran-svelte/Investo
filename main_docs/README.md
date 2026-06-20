# Investo — Documentation Index

| # | Document | Audience | What it covers |
|---|----------|----------|----------------|
| 01 | [01_PRD.md](./01_PRD.md) | Product / stakeholders | Vision, personas, functional requirements (incl. FR-AI-9), non-goals |
| 02 | [02_TRD.md](./02_TRD.md) | Engineering leads | Technical requirements, stack, integrations, security |
| 03 | [03_APP_FLOW.md](./03_APP_FLOW.md) | PM + engineers | End-to-end journeys: onboarding, auth, buyer funnel, staff flows |
| 04 | [04_UI_UX_DESIGN.md](./04_UI_UX_DESIGN.md) | Design + frontend | Dashboard IA, screens, UX patterns |
| 05 | [05_BACKEND_SCHEMA.md](./05_BACKEND_SCHEMA.md) | Backend | Prisma models, key tables, enums |
| 06 | [06_IMPLEMENTATION_PLAN.md](./06_IMPLEMENTATION_PLAN.md) | Delivery | Phases, milestones, rollout |
| 07 | [07_AIAGENT_FLOW.md](./07_AIAGENT_FLOW.md) | AI + backend | Six AI surfaces, H0–H9 orchestrator, workflows, Zero-UI |
| **08** | **[08_BUYER_CONVERSATION_PLAYBOOK.md](./08_BUYER_CONVERSATION_PLAYBOOK.md)** | **Sales + QA + eng** | **Turn-by-turn buyer scripts from “Hi” through visit/call — client / agent / dashboard POV** |
| **enterprise** | **[enterprise.md](./enterprise.md)** | **Platform + eng leads** | **True enterprise maturity model (12 domains), gap analysis, exit criteria** |
| **full** | **[full.md](./full.md)** | **Product + QA + eng** | **Complete hierarchy tree — every branch: 1st vs nth conversation, handlers, buttons, visit/call, escalation, automation, sockets** |
| **chunks** | **[chunks/README.md](./chunks/README.md)** | **Platform implementers** | **7 pillar implementation chunks — one spec per necessary product pillar (lead → go-live)** |

---

## Is `main_docs` enough?

**For engineering architecture:** yes — 01–07 cover PRD, TRD, flows, schema, and AI pipeline.

**What was missing (now added in doc 08):**

- Exact **opening conversation** behavior (`Hi`, `Hello`, `Hey`, good morning)
- **Sample message text** the buyer sees vs what the agent/dashboard gets
- **Interactive button IDs** (`filter-2bhk`, `call-me`, `book-visit-{id}`, etc.)
- **Per-turn CRM side effects** (lead status, calendar, reminders, sockets)
- **QA / handset proof** mapping (which E2E scenario covers which turn)

**Optional future docs** (not created yet — add only if teams ask):

| Doc | When you need it |
|-----|------------------|
| `09_STAFF_COPILOT_PLAYBOOK.md` | Sales training on WhatsApp copilot phrases |
| `10_OPS_RUNBOOK.md` | On-call: Railway, Meta webhook, Redis, secrets rotation |
| `11_API_REFERENCE.md` | Public REST catalog beyond inline route comments |

---

## Quick links (production)

| Resource | URL / path |
|----------|------------|
| Frontend | https://biginvesto.online |
| Backend API | https://investo-backend-production.up.railway.app/api |
| Handset E2E script | `backend/scripts/e2e-handset-proof.mjs` |
| Checklist status | `CHECKLIST_STATUS.md` (repo root) |
| Handset proof report | `backend/docs/PRODUCTION_HANDSET_PROOF_REPORT.md` |

**Last updated:** 2026-06-20
