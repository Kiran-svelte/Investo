# Chunk 12 — Buyer Workflows (PART IX)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | 12 | full.md **PART IX** — 8 buyer workflows + registry steps |

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `workflow/workflow-engine.service.ts` | `classifyAndRunBuyerWorkflow`, `runWorkflow` channel=buyer |
| `workflow/workflow-registry.ts` | WORKFLOW_DEFINITIONS — buyer-facing ids only |
| `workflow/workflow-catalog.util.ts` | Buyer classifier catalog |
| `workflow/actions/inquiry-actions.ts` | price, brochure, amenities, availability |
| `workflow/actions/visit-actions.ts` | book, cancel, reschedule (buyer channel) |
| `workflow/actions/escalation-actions.ts` | escalate_to_human |
| `tests/unit/workflow-engine*.test.ts` | extend |

---

## 3. Buyer workflow IDs (H7 classifier targets)

| ID | Steps (from registry) |
|----|----------------------|
| brochure_request | resolveLead → sendBrochure → logBrochureRequest → updateLeadScore |
| price_inquiry | fetchPropertyPrice → respondPrice → notifyIfHot |
| availability_check | checkInventory → respondAvailability → updateLeadInterest |
| amenities_question | answerAmenities → updateLeadPreferences |
| schedule_visit | resolveLead → bookVisit → … |
| reschedule_visit | resolveVisit → cancelVisitSlot → bookVisit → rescheduleReminders |
| cancel_visit | resolveVisit → cancelVisit → scheduleFollowUp |
| escalate_to_human | createUrgentAlert → notifyAllAgents |

---

## 4. Classifier algorithm (H7)

```
Temperature 0 LLM or rules → workflowId
Guard: explicit brochure vs price vs visit disambiguation (workflow-engine comments)
runWorkflow with toolContext channel='buyer', userRole='company_admin' system user
Return reply text — no staff-only side effects
```

---

## 5. REMOVE

- Buyer workflows mutating via staff-only tools without channel guard
- Duplicate brochure send outside sendBrochure action

---

## 6. Verification

E2E: `buyer-03-brochure`, `buyer-04-price`

---

## Next: [chunk-13.md](./chunk-13.md)
