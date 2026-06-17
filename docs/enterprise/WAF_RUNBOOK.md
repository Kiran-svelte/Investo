# WAF Runbook — Investo Production Edge

## Scope

Cloudflare (recommended) sits in front of:

- Frontend: `biginvesto.online`
- API: `investo-backend-production.up.railway.app` (or custom API hostname)

## Required rules

1. **OWASP core ruleset** — enabled in managed rules.
2. **Rate limiting** — complement app `rateLimiter.ts`; do not replace webhook-specific limits.
3. **Bot fight mode** — challenge suspicious traffic only on dashboard routes, not WhatsApp webhooks.

## Meta webhook allowlist (critical)

WhatsApp Cloud API webhooks must never be blocked.

- Path: `/api/webhooks/whatsapp`
- Maintain Meta IP ranges in Cloudflare IP Access rules (allow) **before** managed challenge rules.
- Mirror allowlist checks in `whatsappSecurity.ts`.

## Rollout checklist

| Step | Action | Proof |
|------|--------|-------|
| 1 | Enable Cloudflare proxy (orange cloud) on API + app DNS | `curl -I` shows `cf-ray` header |
| 2 | Create allow rule for Meta webhook IPs | Test webhook delivery from Meta dashboard |
| 3 | Enable OWASP managed rules (log-only 24h) | Review Cloudflare Security Events |
| 4 | Switch OWASP to block | No false positives on `/api/health/live` |
| 5 | Document rule IDs in this file | Link to Cloudflare dashboard export |

## Incident: webhook blocked

1. Check Cloudflare Security Events for blocked POST to `/api/webhooks/whatsapp`.
2. Temporarily set managed rules to log-only for webhook path.
3. Add explicit allow rule for offending Meta IP range.
4. Replay dead-letter queue: `/dashboard/message-failures` (super-admin).

## DDoS

Cloudflare automatic L3/L7 DDoS protection is enabled by default on proxied zones.

## Change control

WAF rule updates require:

- Audit log entry (`waf_rule_updated`)
- Post-change synthetic check: `npm run synthetic`
