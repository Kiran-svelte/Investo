# LangGraph + Enterprise Agent Integration

## What is integrated

- Existing `POST /api/webhook` flow now supports **optional** forwarding to LangGraph.
- Existing AI pipeline now supports **optional** enterprise-agent bridge path.
- Both are controlled via feature flags; default behavior remains unchanged.

## New backend config flags

- `LANGGRAPH_ENABLED` (`true|false`, default `false`)
- `LANGGRAPH_URL` (default `http://localhost:8000`)
- `LANGGRAPH_MODE` (`augment|replace`, default `augment`)
- `LANGGRAPH_TIMEOUT_MS` (default `5000`)

- `ENTERPRISE_AGENT_ENABLED` (`true|false`, default `false`)
- `ENTERPRISE_AGENT_MODE` (`augment|replace`, default `augment`)

## Modes

- `augment`: call external/bridge path, then continue current `whatsappService.handleIncomingMessage` pipeline.
- `replace`: if external/bridge call succeeds, skip default pipeline for that message.

## Files changed

- `backend/src/services/langgraphAdapter.service.ts`
- `backend/src/services/enterpriseAgentBridge.ts`
- `backend/src/routes/webhook.routes.ts`
- `backend/src/config/index.ts`

## Notes on external repos

- `external/langgraph-integration` is cloned for reference and contract mapping.
- Kaggle `enterprise-agents` notebook is **not fully portable as-is** into this Node backend runtime.
  This implementation ports the operational pattern into `enterpriseAgentBridge` using the existing `aiService` contract.

## Verification status

- Backend TypeScript build passes.
- Added focused unit tests for adapter and bridge.
- Existing unrelated repository tests may fail due prior baseline issues.
