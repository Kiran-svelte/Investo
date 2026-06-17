# k6 load tests (Investo)

Basic staging load smoke used by the enterprise exit gate and release train.

## Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) installed locally or in CI
- Backend reachable at `BASE_URL` (default `http://localhost:3001`)

## Run locally

```bash
# Against local backend
k6 run infra/k6/load-test.js

# Against staging / production (read-only health endpoints only)
BASE_URL=https://investo-backend-production.up.railway.app k6 run infra/k6/load-test.js
```

## Pass criteria

| Metric | Threshold |
|--------|-----------|
| `http_req_duration` p95 | < 500 ms |
| `http_req_failed` | < 1% |

## Exit gate integration

```bash
cd backend
RUN_K6=true EXIT_GATE_BASE_URL=https://your-staging-url npm run exit-gate
```

Without `RUN_K6=true`, the exit gate only verifies that `infra/k6/load-test.js` exists.

## Scenarios (future)

Chunk 15 target scenarios (webhook burst, mixed tenants, AI turns) can extend this script or add sibling files under `infra/k6/`.
