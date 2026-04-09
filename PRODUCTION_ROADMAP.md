# Production Roadmap

Status key: `Done Now` = already implemented and working, `Partial` = present but needs follow-through, `Not Started` = not yet built.

## 1. Core Platform
- `Done Now` React 18 + TypeScript + Tailwind frontend stack is in place.
- `Done Now` Node.js + Express + TypeScript backend stack is in place.
- `Done Now` Monorepo split between `frontend/` and `backend/` is established.
- `Done Now` Docker and Docker Compose are present for local and deployable runs.
- `Done Now` Prisma and PostgreSQL are wired into the backend service layer.
- `Partial` Production deployment scripts and environment hardening still need a final pass.

## 2. Authentication and Security
- `Done Now` JWT access and refresh token flow exists.
- `Done Now` bcrypt password hashing is used.
- `Done Now` Rate limiting middleware is present for user and company scopes.
- `Done Now` CORS, helmet, and general API hardening are wired into the app.
- `Partial` Secret management is env-driven, but production secret rotation policy is not documented.
- `Partial` Security logging and redaction are implemented, but should be regression-tested under live traffic.

## 3. Multi-Tenant Isolation and RBAC
- `Done Now` Tenant-aware middleware and company-scoped data access are part of the backend design.
- `Done Now` Role-based access control is implemented for the primary platform roles.
- `Partial` Cross-tenant protection should be verified on every route and query path.
- `Partial` Super admin boundaries need a final audit to ensure read-only behavior for company business data.
- `Partial` Custom roles and feature-flag driven permissions still need stronger end-to-end validation.
- `Not Started` Formal tenant-isolation test suite for every data path.

## 4. CRM: Leads and Conversations
- `Done Now` Lead creation, update, and lifecycle routing exist in the backend.
- `Done Now` Conversation state handling for AI-active and agent-active flows exists.
- `Partial` Lead state-machine enforcement needs explicit negative-path tests.
- `Partial` Assigned-agent visibility and operational read/write boundaries need a final UI/API audit.
- `Partial` Lead timeline, filters, and bulk actions exist in parts of the app but need end-to-end completion.
- `Not Started` Full regression coverage for reopen, terminal-state, and duplicate-lead edge cases.

## 5. Properties and Visits
- `Done Now` Property inventory and visit scheduling modules exist.
- `Done Now` Backend prevents obvious invalid scheduling cases such as past visits and double booking.
- `Partial` Calendar UX still needs stronger availability visualization and conflict feedback.
- `Partial` Property media handling is present, but upload and storage flows should be validated in production mode.
- `Partial` Reminder and reschedule flows need a last-mile reliability check.
- `Not Started` Load test for visit scheduling concurrency.

## 6. WhatsApp AI Engine
- `Done Now` WhatsApp webhook, message ingestion, and tenant lookup flow exist.
- `Done Now` AI prompt wiring is restricted to the real-estate domain.
- `Done Now` Property matching and multi-language response handling are implemented.
- `Partial` Message deduplication, async queueing, and retry logic need stronger resilience work.
- `Partial` Media message types and status receipts are still incomplete.
- `Not Started` Full Meta-scale webhook reliability and failure-recovery path.

## 7. Multilingual UI and AI Behavior
- `Done Now` The AI supports the target Indian language set.
- `Done Now` The frontend has an i18n structure and a language selector entry point.
- `Partial` Not all UI strings are guaranteed to be externalized yet.
- `Partial` Mixed-language and mid-conversation language switching need broader validation.
- `Not Started` Language QA matrix across all supported locales.

## 8. Dashboard and Analytics
- `Done Now` Core dashboard pages are present for admin, CRM, and reporting workflows.
- `Partial` Role-specific dashboard completeness should be checked page by page.
- `Partial` Analytics visualizations and export quality still need polish.
- `Partial` Auto-refresh and live-update behavior should be validated under real user sessions.
- `Not Started` Dedicated performance budget tracking for dashboard load time.

## 9. Automation and Notifications
- `Done Now` Lead auto-creation and visit reminder workflows exist.
- `Done Now` Lead assignment automation is present.
- `Partial` Follow-up rules and live push behavior still need more robustness, but reminder/follow-up execution now uses a durable queue worker.
- `Partial` WebSocket or equivalent real-time delivery should be verified end to end.
- `Partial` Queue-backed automation workers now exist, but scale-out and failure injection still need production validation.

## 10. Billing, Onboarding, and Feature Flags
- `Done Now` Billing and subscription modules are scaffolded in the product surface.
- `Partial` Invoice generation and plan-limit enforcement need production verification.
- `Partial` The onboarding flow exists, but browser-level completion and resume behavior should be tested.
- `Partial` Feature flags and company-specific module gating need tighter functional coverage.
- `Not Started` Self-serve upgrade and downgrade validation.

## 11. Audit, Compliance, and Data Retention
- `Done Now` Audit log concepts and write-operation traceability are present.
- `Partial` Audit completeness should be checked for every mutating endpoint.
- `Partial` Company retention and export workflows need formal operational sign-off.
- `Partial` Deactivate-only company lifecycle rules should be verified in admin flows.
- `Not Started` Documented compliance policy for retention, export, and privacy handling.

## 12. Infrastructure and Performance
- `Done Now` Neon-only database configuration is enforced in backend config.
- `Done Now` Kimi is the primary AI provider with fallback support in the service layer.
- `Done Now` S3-compatible object storage integration (Cloudflare R2 by default; Backblaze B2/MinIO supported via `R2_ENDPOINT`) is implemented for property assets.
- `Partial` API p95, webhook latency, and AI response SLAs are not yet instrumented end to end.
- `Partial` Database pool sizing, UTC handling, E.164 checks, and decimal money rules need a final data-quality audit.
- `Not Started` Production monitoring and alert thresholds.

## 13. Testing and Release Hardening
- `Done Now` Unit tests cover config guards and core validation behavior.
- `Done Now` Jest build/test scripts are wired in the backend package.
- `Partial` Integration and E2E coverage are present in structure, but not comprehensive enough for release confidence.
- `Partial` The browser-facing onboarding and CRM flows need quick manual verification after changes.
- `Not Started` Load testing and failure-injection tests for WhatsApp, AI, and storage flows.
- `Not Started` Formal release checklist for production go-live.

## Implemented In This Pass
- `backend/src/config/index.ts`: locked `DATABASE_URL` to Neon-only connection strings, defaulted AI provider config to Kimi with an explicit Kimi 2.5 model, and added R2 storage environment wiring.
- `backend/src/services/ai.service.ts`: kept Kimi as the primary provider path and sends chat/completions requests with the configured Kimi 2.5 model.
- `backend/src/services/storage.service.ts`: added S3-compatible client setup, signed upload URL generation, and public asset URL construction for property media.
- `backend/src/services/automationQueue.service.ts` and `backend/src/services/automation.service.ts`: added durable queued processing for visit reminders, follow-ups, and conversation timeout closures.
- `backend/src/tests/unit/config.test.ts`: added coverage for Neon URL validation and config defaults that support the new backend baseline.

## Next 3 Execution Waves
### Wave 1 - Platform hardening
Priority: P0.
Acceptance criteria: Neon-only DB guard holds in all environments; Kimi primary provider works with fallback; S3-compatible uploads and public URLs are verified with a real property asset.

### Wave 2 - Core product reliability
Priority: P0.
Acceptance criteria: WhatsApp ingestion, deduplication, lead creation, and conversation state transitions are covered by tests; invalid lead and visit transitions are blocked.

### Wave 3 - Production readiness
Priority: P1.
Acceptance criteria: Dashboard and onboarding flows pass a browser smoke test; analytics and notification paths are validated; build and backend test suite stay green after the release pass.