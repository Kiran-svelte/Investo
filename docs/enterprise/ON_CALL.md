# Investo — On-Call Guide

| Field | Value |
|-------|-------|
| Version | chunk-07 |
| Related | [INCIDENT_RUNBOOK.md](./INCIDENT_RUNBOOK.md) |

---

## Rotation

| Role | Responsibility |
|------|----------------|
| **Primary on-call** | First responder; ack alerts within 15 min (P1) |
| **Secondary on-call** | Backup if primary unreachable in 10 min |
| **Platform lead** | Escalation for schema/migration/data issues |

Configure rotation in PagerDuty (or Opsgenie). Webhook target:

```
SLO_ALERT_WEBHOOK=https://events.pagerduty.com/v2/enqueue
FEATURE_SLO_ALERTS=true
```

---

## Alert rules (minimum)

| Rule ID | Severity | Trigger |
|---------|----------|---------|
| `api_error_budget_burn_2x` | P2 | 5xx error rate burn ≥ 2× monthly budget |
| `worker_lag_or_dlq_p1` | P1 | Worker lag SLO breached or WhatsApp DLQ > 0 with circuit open |

Test alert:

```bash
cd backend
SLO_ALERT_WEBHOOK=https://your-webhook npm run synthetic -- --alert
```

Or super-admin API (authenticated):

```
POST /api/platform/observability/test-alert
```

---

## Escalation path

1. Primary on-call (0–15 min)
2. Secondary on-call (15–30 min)
3. Platform lead + founder (30+ min P1)

---

## Shift checklist

At start of shift:

- [ ] `npm run synthetic` against production base URL
- [ ] Review Grafana Platform Overview + SLO Burn dashboards
- [ ] Check Sentry unresolved P1/P2 issues
- [ ] Confirm worker heartbeat (`ops:worker:heartbeat` in Redis when worker running)

At end of shift:

- [ ] Hand off open incidents in `#incidents`
- [ ] Note any degraded components on status page

---

## Status page

Public URL (configure in env):

```
STATUS_PAGE_URL=https://status.investo.com
FEATURE_PUBLIC_STATUS_API=true
```

API mirror (for automation):

```
GET /api/status
GET /api/status/slo
```

Update external status page during P1/P2 per [INCIDENT_RUNBOOK.md](./INCIDENT_RUNBOOK.md).

---

## Grafana

Import dashboards from `infra/grafana/*.json`.

```
GRAFANA_BASE_URL=https://grafana.your-org.com
```

Super-admin in-app summary: `/dashboard/observability`
