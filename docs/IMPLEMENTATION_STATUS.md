# Implementation status matrix

Honest audit against `docs/MASTER_IMPLEMENTATION_SPEC.md` and `docs/RE_WHATSAPP_AGENT_PRODUCT_SPEC.md`.  
**Phase 4** = intentionally not built (external APIs / legal).

| Area | Item | Status | Notes / files |
|------|------|--------|----------------|
| **D01 WhatsApp** | Meta Cloud inbound/outbound | built | `webhook.routes.ts`, `whatsapp.service.ts`, Meta provider |
| | Green API dual provider | built | `greenapi-webhook.routes.ts`, provider routing |
| | Media (image/doc/location) | partial | `whatsapp.service.ts` sendImage/Document/Location; Green API fallback text |
| | Post-shortlist auto media | partial | `sendPropertyMediaForStage` |
| **D02 AI + conversion** | Goal-directed state machine | built | `conversationStateMachine`, `ai.service.ts` |
| | Never-Say-No tiers 1–6 (tenant inventory) | built | `alternativeInventory.service.ts`, `neverSayNoEngine.service.ts` |
| | Conversion prompt block | built | `conversionEngine.service.ts` (legacy), NSN engine |
| | Post-LLM dead-end guard | built | `neverSayNoResponseGuard.service.ts` |
| | Ungrounded numbers/claims strip | built | `groundingGuard.service.ts` (this sprint) |
| | Legal disclaimer (first contact) | built | `legalDisclaimer.constants.ts`, `ai.service.ts` |
| | Copywriter polish pass | built | `messagePolish.service.ts` → WhatsApp path |
| | 46-scenario scripted dialogues | partial | Prompt sections + intents; not 46 isolated handlers |
| | Partner inventory (tier 8) | partial | `searchPartnerInventory` in NSN engine; manual partner IDs |
| | Portal / MagicBricks / 99acres | not built | Phase 4 — config stubs only |
| | Fractional ownership copy | partial | Snippet in `neverSayNoEngine.service.ts`; not separate product |
| **D03 Property catalog** | CRUD + import drafts | built | `property.routes.ts`, `propertyImport.service.ts` |
| | Completeness / publishable gate | built | `propertyCompleteness.service.ts`, `propertyCompletenessGate.ts` |
| | Brochure extraction | built | `propertyImportWorker.service.ts` |
| **D04 Leads CRM** | Pipeline + assignment | built | `lead.routes.ts`, `leadAssignment.service.ts` |
| | State machine enforcement | built | `leadTransition.service.ts` |
| **D05 Visits** | WhatsApp book + UUID slot fix | built | `visitBooking.service.ts` |
| | REST schedule | built | `visit.routes.ts` |
| | Reminders 24h/1h | built | `automation.service.ts` |
| **D06 Agents** | RBAC + agent AI tools | built | `agent/tools/*`, LangGraph adapter |
| **D07 Nurture** | 48h / 7d negotiation | built | `automation.service.ts` |
| | 3d / 7d / 30d nurture (en/hi/kn) | built | `nurtureMessage` templates |
| | Nurture via polish LLM | partial | Templates deterministic; polish optional on outbound |
| **D08 Admin** | AI settings | built | `ai-settings.routes.ts` |
| | Conversion settings UI API | built | `conversion-settings.routes.ts` |
| **D09 Partners / CRMs** | 50 partner CRM APIs | not built | Phase 4 |
| | Referral fee / referrals table | not built | Phase 4 |
| | Cross-channel SMS / Instagram | not built | Phase 4 |
| **Buyer UX** | Zero UI (WhatsApp only) | built | `docs/ZERO_UI_BUYER.md`; no buyer auth on webhook/visit |
| **P3 Enterprise** | Tenant isolation test suite | partial | Some route tests; not full suite |
| | Load test webhook | not built | Script mentioned in spec only |

## Funnel stages (conversation)

| Stage | Status | File |
|-------|--------|------|
| rapport | built | `conversationStateMachine` |
| qualify | built | |
| shortlist | built | |
| objection_handling | built | |
| commitment | built | |
| visit_booking | built | `visitBooking.service.ts` |
| human_escalated | built | WhatsApp + notifications |

## This sprint (production hardening)

- [x] Property completeness schema + API gate
- [x] Stronger AI grounding prompts
- [x] Grounding guard (numbers/discounts/possession)
- [x] Message polish layer on customer WhatsApp
- [x] First-contact disclaimer
- [x] Implementation status doc + zero-UI buyer doc
