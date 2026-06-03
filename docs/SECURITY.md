# Investo Security Baseline (OWASP-oriented)

Last updated: June 2026. This document summarizes controls implemented in code and what operators must configure in production.

## A01 Broken Access Control

- JWT authentication on all tenant APIs (`backend/src/middleware/auth.ts`).
- RBAC via `authorize()` / `hasRole()` per route.
- Tenant isolation via `getCompanyId()` — cross-tenant IDs return 404/403.
- Super admin blocked from tenant settings APIs (`rejectPlatformAdminTenantApi`).

## A02 Cryptographic Failures

- Passwords hashed with bcrypt (12 rounds).
- JWT access + refresh tokens; refresh rotation stored as hashes.
- `JWT_SECRET` and `JWT_REFRESH_SECRET` required in production (`config/index.ts`).
- API keys/tokens masked in company API responses (`utils/sanitize.ts`).

## A03 Injection

- Primary data access via Prisma ORM (parameterized queries).
- Raw SQL uses tagged templates with bound parameters only.
- Request body validation via Zod schemas on sensitive writes.

## A04 Insecure Design

- Rate limits: 100 req/min/user, 1000/min/company, 5/min on `/api/auth`, 120/min on webhooks, 10 exports/hour.
- Feature flags gate optional modules per tenant.
- Pagination on list endpoints prevents unbounded memory use.

## A05 Security Misconfiguration

- Helmet security headers enabled globally.
- CORS allowlist via `CORS_ORIGINS` + localhost dev ports.
- `.env` gitignored; never commit secrets.
- Frontend exposes only `VITE_*` public config (API URL, upload limits) — no API keys in bundle.

## A06 Vulnerable Components

- Run `npm audit` in CI; patch high/critical dependencies regularly.

## A07 Authentication Failures

- Login rate limited; generic error messages (no user enumeration).
- Cross-tab refresh lock prevents session rotation races (frontend).
- Logout revokes current session refresh token only.

## A08 Software/Data Integrity

- Webhook signature verification (Meta/GreenAPI) before processing.
- Audit log middleware on mutating admin actions.

## A09 Logging & Monitoring

- Winston JSON logs with recursive secret redaction (`utils/sanitize.ts`).
- Health/readiness endpoints for uptime monitoring.

## A10 SSRF / XSS

- No `dangerouslySetInnerHTML` in React UI; user content rendered as text nodes.
- Document URLs validated as http(s) on property forms.

## Privacy

- See `/privacy` in the frontend and `frontend/src/pages/legal/PrivacyPolicyPage.tsx`.

## Operator checklist

1. Set strong `JWT_SECRET`, `JWT_REFRESH_SECRET`, database URL on Render.
2. Configure `CORS_ORIGINS` to production Vercel domain only.
3. Rotate Render/Vercel/Meta/GreenAPI keys if ever exposed.
4. Revoke temporary API keys shared in support channels.
