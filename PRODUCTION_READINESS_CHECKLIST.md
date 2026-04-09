# Production Readiness Checklist (P0 / P1 / P2)

Generated: 2026-04-09

This is the **verification checklist** for making Investo usable by real production users.

Sources of truth:
- `PRODUCTION_ROADMAP.md`
- `WHATSAPP_INTEGRATION_CHECKLIST.md`
- `STRICT_VERIFICATION.md`
- `DEPLOYMENT_VERIFICATION.md`
- `CHECKLIST_FINAL.md`

---

## P0 — Launch Blockers (must pass before real users)

- [ ] **Meta WhatsApp Business Manager setup complete** (verified phone, Cloud API enabled, app live as needed)
  - Verify: Meta dashboard shows your WhatsApp app + verified phone; you have a long-lived token strategy.

- [ ] **Production env vars set for WhatsApp** (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_IP_WHITELIST_ENABLED`)
  - Verify: Render env has values set; backend logs show WhatsApp config present without dumping secrets.

- [ ] **Webhook verification succeeds from Meta** (GET challenge works from Meta)
  - Verify: Meta webhook verification passes for `https://<backend>/api/webhook`.

- [ ] **Webhook POST accepts Meta traffic and rejects non-Meta** (signature + IP whitelist behave correctly)
  - Verify: `npm run proof:webhook` passes (valid signature => 200, invalid => 403) and Meta can deliver real events.
  - Verify (automated): backend unit test `src/tests/unit/webhook.routes.security.test.ts` passes.

- [ ] **Production "create user" works reliably** (`POST /api/users`)
  - Verify: create user in production UI/API succeeds 3 times in a row; created users can login.

- [ ] **First-login forced password change works** (`must_change_password` redirects to `/change-password`)
  - Verify (UI): Team Members → Add Team Member → keep “Force password change on first login” checked → login as that user → you are forced to `/change-password`.
  - Verify (API): `POST /api/users` with `must_change_password: true`, then login and confirm redirect.

- [ ] **Forgot-password emails are actually delivered** (not just logged)
  - Verify: submit `/api/auth/forgot-password`, receive email, reset link works, old tokens invalidated.

- [ ] **Onboarding gating is airtight** (company admins can’t bypass incomplete onboarding)
  - Verify: new company admin lands on `/onboarding`, resume works, completion redirects to dashboard.

- [ ] **Basic production monitoring + alerting is in place**
  - Verify: uptime check + error alert exists; on forced failure you get notified.
  - Verify (API): `GET /api/health` returns 200 with `dependencies.db.status=ok` and returns 503 if DB is unreachable.

- [ ] **Database backup strategy exists and is tested**
  - Verify: documented backup + restore drill (at least once) for Neon.

---

## P1 — Hardening (required for public launch / enterprise reliability)

### WhatsApp reliability & scale
- [ ] **Inbound idempotency + deduplication** (Meta retries don’t create duplicates)
  - Verify: replay the same webhook payload twice; only one lead/message write occurs.

- [ ] **Durable queue + worker for WhatsApp processing** (no heavy sync work in webhook request)
  - Verify: webhook responds < 5s even under load; jobs are processed by worker.

- [ ] **Outbound retries with exponential backoff**
  - Verify: simulate Meta API 500; message retries 3 times with backoff; then stops.

- [ ] **Circuit breaker for Meta API failures**
  - Verify: after N failures, breaker opens; system degrades gracefully; later recovers.

- [ ] **Dead-letter queue (DLQ) for failed outbound messages**
  - Verify: forced-permanent failures land in DLQ; admin can replay.

- [ ] **Outbound rate limiting (80 msg/sec per phone)**
  - Verify: burst sends are throttled; no Meta throttling errors in logs.

- [ ] **Per-company outbound quotas**
  - Verify: tenant A cannot exhaust capacity for tenant B.

- [ ] **Message status receipts** (sent/delivered/read)
  - Verify: status webhook updates DB + UI timeline.

- [ ] **Media message support** (image/document/location/voice)
  - Verify: each media type is stored and visible in conversation timeline; voice transcribed if enabled.

- [ ] **Template messages + interactive messages** (buttons/lists)
  - Verify: templates send successfully; button replies are parsed and stored.

- [ ] **Working hours enforcement**
  - Verify: outside working hours AI responds with “we’ll respond during business hours” (per company config).

### Security / tenancy
- [ ] **Tenant isolation audit + negative tests**
  - Verify: every data route rejects cross-tenant access; automated tests exist.

- [ ] **RBAC matrix validation (system + custom roles)**
  - Verify: each role/action is enforced in API; tests cover at least one deny case per resource.

### Billing / compliance
- [ ] **Plan limit enforcement in production**
  - Verify: exceeding agent/lead/property limits is blocked with clear error.

- [ ] **Invoice generation verified**
  - Verify: invoices are generated and visible for a test tenant.

- [ ] **Self-serve upgrade/downgrade works**
  - Verify: upgrade immediately unlocks features; downgrade enforces limits.

- [ ] **Retention/export/privacy policy implemented**
  - Verify: retention rules + data export exist and are documented; logs are redacted.

### Observability & reliability testing
- [ ] **SLA instrumentation** (p95 API/webhook latency + AI response time)
  - Verify: dashboards/metrics exist; thresholds alert.

- [ ] **Load tests + failure injection** (WhatsApp/AI/storage)
  - Verify: k6/Artillery scripts run; results documented; regressions caught.

---

## P2 — Polish (improves daily usage and adoption)

- [ ] **Calendar availability grid**
  - Verify: calendar shows free/busy per agent and prevents conflicts visually.

- [ ] **Real-time notifications push** (WebSocket/SSE)
  - Verify: notification appears without refresh on key events.

- [ ] **Analytics charts** (funnel/trends/leaderboards)
  - Verify: charts render with meaningful defaults; export works.

- [ ] **UI i18n completeness + QA matrix**
  - Verify: all strings externalized; at least a smoke pass across supported locales.
