# WhatsApp CRM Workflow Engine

Five-layer architecture for staff copilot and buyer WhatsApp paths:

1. **Workflow Engine** — `runWorkflow(workflowId, ctx, params)` runs ordered steps; stops on failure or `stop`.
2. **Actions** — Reusable handlers in `backend/src/services/workflow/actions/` (lead, visit, inquiry, agent, escalate).
3. **Workflows** — Fifteen definitions in `backend/src/services/workflow/workflow-registry.ts`.
4. **LLM Integration** — Staff: `agent-intent-orchestrator` classifies + extracts; `INTENT_TO_WORKFLOW` maps intent → workflow. Buyer: `tryRunBuyerWorkflow` keyword routing + optional `classifyWorkflowMessage`.
5. **Main Handler** — `agent-router.service.ts` → `classifyAndExecuteAgentIntent` → `runWorkflowForIntent`. Buyer: `whatsapp.service.ts` after visit booking attempt.

## Staff example

Message: *"Update lead kannada media status to visited"*

1. Router calls `classifyAndExecuteAgentIntent`.
2. LLM classifies `update_lead_status`, extracts `{ leadName, status: visited }`.
3. `runWorkflowForIntent` → workflow `update_status`.
4. Steps: `resolveLead` → `updateLeadStatus` → `logLeadHistory` → `notifyIfCritical` (if applicable) → `syncLeadMemory`.
5. WhatsApp reply from `updateLeadStatusById` / `leadTransition.service`.

## Registry

See `WORKFLOW_DEFINITIONS` and `INTENT_TO_WORKFLOW` in `workflow-registry.ts`.

## Tests

`npm test -- --testPathPattern="workflow|agent-intent|agent-crm"`
