# Full-Stack Readiness Operating Model

Big Investo is not ready because one module works. It is ready only when the
whole market-facing system works together for multiple real agencies: product
journeys, UI, backend, data, workflows, tenant isolation, billing, mail,
identity, support, observability, deployment, and security.

This model defines the decision language used by
`backend/scripts/fullstack-readiness-audit.mjs`.

## Decision Language

- Keep: proven product or technical behavior that should remain in the platform
  and be protected by tests or production proof.
- Remove: tracked artifacts, legacy surfaces, insecure defaults, duplicate
  workflows, stale readiness claims, or UX that creates operator confusion.
- Upgrade: useful behavior that exists but is not yet strong enough for paid
  enterprise use.
- Block: a release or readiness claim cannot proceed until this is fixed and
  proven.

## Market/FDE Definition

For this product, a market engineer or FDE view means the platform must survive
real implementation pressure:

- A new agency can be onboarded without engineering support.
- Admins, sales agents, operations users, and viewers can work without hidden
  tenant leakage or role confusion.
- The buyer conversation path can move from lead capture to property shortlist,
  visit, follow-up, and conversion without manual database intervention.
- Platform admin can operate multiple companies without accidentally polling or
  mutating tenant data.
- Mail, WhatsApp, identity, billing, and support failures are visible and
  recoverable.
- Source control and deploy hygiene are clean enough for a team to operate.

## Required Domains

1. Market and FDE operating model
2. Frontend UX, role paths, and workflow coverage
3. Backend domain integrity and tenant isolation
4. AI, WhatsApp, and workflow reliability
5. Mail, onboarding, and invite delivery
6. Identity, security, and compliance
7. Billing and commercial operations
8. Observability, operations, and reliability
9. Repository and deploy hygiene

## Release Rule

`npm run readiness:fullstack` must pass before a readiness claim. If it fails,
the failure is the current product truth. The right response is to fix the
blocker or explicitly record why the blocker is external, not to mark the
platform ready from documentation alone.

## Current Known Blocking Pattern

The current exit report can pass onboarding, tenant isolation, role matrix,
MFA, SCIM, and SSO while still staying not-ready if Resend delivery-event proof
is unavailable. Accepted sends are useful evidence, but delivered, bounced,
suppressed, delayed, and failed events must be observable before mail is an
enterprise-ready gate.
