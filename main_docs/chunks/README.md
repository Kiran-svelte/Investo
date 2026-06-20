# Investo — Seven Pillar Implementation Chunks

| Field | Value |
|-------|-------|
| Master doc | [../enterprise.md](../enterprise.md) |
| Product framing | [../../docs/NECESSARY.md](../../docs/NECESSARY.md) |
| Total chunks | **7** (one chunk = one pillar = one epic) |
| Execution | Complete Definition of Done + proof gates before starting the next chunk |
| Last updated | 2026-06-20 |

---

## Purpose

Each chunk is a **single-feature, production-grade spec** for one of Investo’s **7 necessary pillars** — the capabilities an agency needs for peaceful daily use without a second CRM.

Every chunk documents:

- **NOW** — what works in production today vs test-only / partial
- **AFTER** — target UX and functioning when chunk is fully hardened
- **Implementation plan** — phased work, files, schema, flags
- **Enterprise hardening** — security, tenancy, observability, kill switches
- **Real-time usage** — live scenarios (WhatsApp, dashboard, sockets, cron)
- **Tests & proof** — unit, integration, smoke, handset, production verification

Buyer AI polish and WhatsApp UX micro-flags remain in `.cursor/rules/whatsapp-enterprise-readiness.mdc`. These chunks cover **platform + pillar completeness**.

---

## Chunk index

| # | File | Pillar | Single focus | Priority |
|---|------|--------|--------------|----------|
| 01 | [chunk-01.md](./chunk-01.md) | Pillar 1 | Lead capture, assignment & pipeline ownership | P0 |
| 02 | [chunk-02.md](./chunk-02.md) | Pillar 2 | Conversations — visibility, takeover, staff reply | P0 |
| 03 | [chunk-03.md](./chunk-03.md) | Pillar 3 | Property inventory, import, knowledge & publish | P0 |
| 04 | [chunk-04.md](./chunk-04.md) | Pillar 4 | Visit booking, calendar, reminders & conversion | P0 |
| 05 | [chunk-05.md](./chunk-05.md) | Pillar 5 | Team access — roles, invites, MFA, SSO, SCIM | P1 |
| 06 | [chunk-06.md](./chunk-06.md) | Pillar 6 | Owner dashboard, analytics & export | P1 |
| 07 | [chunk-07.md](./chunk-07.md) | Pillar 7 | Onboarding, go-live readiness & platform ops | P0 |

---

## Recommended execution order

```
07 (readiness baseline) → 01 → 03 → 04 → 02 → 06 → 05
```

- **07 first** — unblocks every tenant (WhatsApp, mail, readiness score honest).
- **05 last among pillars** — enterprise IAM builds on stable CRM; SSO OIDC callback is the largest net-new build.

Cross-cutting enterprise ops (async WhatsApp, quotas, compliance cron, public API) are **called out inside the pillar they affect**, not as separate chunks.

---

## Global gates (every chunk)

```bash
cd backend && npx tsc --noEmit
cd backend && npx jest <chunk-tests> --runInBand --no-cache
cd backend && npm run smoke
node scripts/production-smoke-test.mjs
```

Production URLs:

| Resource | URL |
|----------|-----|
| Frontend | https://biginvesto.online |
| Backend | https://investo-backend-production.up.railway.app/api |

---

## Terminology

| Term | Meaning |
|------|---------|
| **Pillar** | One of 7 necessary product capabilities (`docs/NECESSARY.md`) |
| **Peaceful use** | 30 days of agency ops without manual DB edits or a parallel CRM |
| **Test mode** | Feature flag or stub path — not acceptable for enterprise sales |
| **Enterprise hardening** | Tenant isolation, audit, SLO, enforcement (not just UI) |
