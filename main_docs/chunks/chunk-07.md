# Chunk 07 — Onboarding, Go-Live Readiness & Platform Ops

| Field | Value |
|-------|-------|
| Chunk | 07 of 7 |
| Pillar | 7 — Setup without platform operator in the loop |
| Priority | P0 |
| Depends on | Nothing (run first) |
| Unblocks | All other chunks |

---

## 1. Single-feature scope

**One focus only:** A **company admin can self-serve from zero to live** — onboarding wizard, WhatsApp connection, readiness score, mail delivery, billing hook — with **super-admin platform ops** for tenant creation and health — **without manual DB edits**.

---

## 2. Current state — NOW

### 2.1 Production today (working)

| Capability | Status | Code / route |
|--------------|--------|--------------|
| 6-step onboarding wizard | ✅ | `OnboardingPage`, `/api/onboarding` |
| Company provisioning | ✅ | `companyProvisioning.service` |
| Readiness API | ✅ | `GET /api/readiness` |
| Health + live deps | ✅ | mail ok, whatsapp_inbound ok, db ok |
| Super-admin companies + invites | ✅ | `CompaniesPage`, `AgencyInvitesPage` |
| Agency invite email + trial | ✅ | `agencyInvite.routes`, Resend |
| Self-service signup (flag-gated) | ✅ | `FEATURE_SELF_SERVICE_SIGNUP` |
| Billing / Cashfree | ✅ | when keys configured |
| Railway + Vercel production | ✅ | biginvesto.online + Railway API |
| Production smoke test | ✅ | 20/20 with tenant-scoped super admin |
| Enterprise flags script | ✅ | `scripts/enterprise-enable-railway.mjs` |

### 2.2 Test-only / partial / gaps

| Gap | Impact | Severity |
|-----|--------|----------|
| WhatsApp creds **tenant-operated** | Largest go-live friction | **High** |
| Stale demo users in docs | Failed login expectations | Medium |
| `SSO_TEST_IDP=true` in prod | Misleading "enterprise ready" | High (see Chunk 05) |
| Quota hard enforce off | No billing pressure at limit | Medium |
| Compliance retention purge not scheduled | Data retention policy soft | Medium |
| Redis required for scale; fallback in-memory in dev | Queue loss risk | Medium |
| Render docs vs Railway canonical URL | Confusion in old guides | Low |
| Backend Jest suite partially red | CI confidence gap | Medium |

### 2.3 User experience TODAY

| Persona | Experience |
|---------|------------|
| **New company admin** | Invite link OR super-admin created → login → forced onboarding → WhatsApp step hardest → publish property → readiness green. |
| **Super admin** | Creates company → sends agency invite → checks platform health. |
| **Buyer** | Only interacts after tenant WhatsApp live. |

---

## 3. Target state — AFTER

### 3.1 Perfect functioning

- Readiness score **honest**: red until WhatsApp verified + 1 published property + 1 agent.
- Onboarding resumable across devices; progress persisted server-side.
- WhatsApp setup: guided Meta steps with validation ping (`GET webhook` + test message).
- Mail: 100% forgot-password and invite delivery < 60s.
- Super-admin can clone demo tenant template for sales (sandbox flag).
- Platform health page shows all tenants' webhook status aggregate.
- 30-day peaceful use bar met (`docs/NECESSARY.md` checklist).

### 3.2 User experience AFTER

| Persona | After fix |
|---------|-----------|
| **Admin** | Onboarding checklist with links to Meta Business Suite; test inbound button. |
| **Super admin** | One-click "bootstrap enterprise IAM" for new tenant (identity config row). |
| **Support** | Tenant health page shows last webhook + last AI reply timestamp. |

---

## 4. Implementation plan

### Phase 1 — Readiness truth (week 1)

| Task | Files |
|------|-------|
| Readiness checks match NECESSARY checklist | `readiness.service.ts`, `readiness.routes` |
| Onboarding gate cannot skip WhatsApp verify | `OnboardingGuard`, step validation |
| Re-seed doc credentials OR remove from all docs | `CHECKLIST_FINAL.md`, smoke defaults ✅ |
| Bootstrap script for demo tenant | `bootstrap-enterprise-tenants.mjs` |

### Phase 2 — WhatsApp go-live (week 2)

| Task | Files |
|------|-------|
| In-app Meta webhook URL display + copy | `AISettingsPage`, onboarding step |
| Post-config test ping | `whatsappHealth.service`, button in UI |
| Migrate creds helper | `migrate-railway-meta-to-company-settings.mjs` |
| Per-tenant webhook proof script | `verify-production-mail-and-webhook.mjs` |

### Phase 3 — Platform ops (week 3)

| Task | Files |
|------|-------|
| Schedule compliance retention purge cron | `complianceRetention.service`, worker |
| Enable quota hard enforce after soak | Railway env |
| Fix backend Jest ESM (otplib) for CI green | `jest.config.js` |
| Update all deployment docs to Railway canonical | `DEPLOYMENT_GUIDE.md`, `main_docs/README.md` |

### Phase 4 — Enterprise bootstrap (week 4)

| Task | Files |
|------|-------|
| Auto-create `company_identity_configs` on company create | `companyProvisioning.service` |
| Sandbox tenant flag for sales demos | `FEATURE_SANDBOX_TENANTS` |
| DR read-only mode drill documented | `DR_RUNBOOK.md` |

---

## 5. Enterprise hardening

| Control | Requirement |
|---------|-------------|
| Secrets | WhatsApp tokens in company.settings JSON — never log |
| Multi-tenant webhooks | Route inbound by phone number ID → company |
| Backup | `BACKUP_LAST_SUCCESS_AT` tracked for exit gate |
| Read-only DR | `FEATURE_READ_ONLY_MODE` tested quarterly |
| Audit | Company create, invite sent, onboarding complete |
| SLO | Health `/api/health/live` for Railway deploy probe |

**Kill switches:**

- `FEATURE_READ_ONLY_MODE=true` — platform-wide read-only (DR)
- `FEATURE_SELF_SERVICE_SIGNUP=false` — invite-only registration

---

## 6. Real-time usage scenarios

```
Day 0  Super admin creates "Sunrise Realty" + agency invite email
Day 0  Admin clicks invite → sets password → /onboarding
Day 1  Steps 1-4: profile, team, WhatsApp Meta creds pasted
Day 1  Readiness: whatsapp_inbound yellow → admin fixes token → green
Day 2  Property import publish → readiness: property ok
Day 3  Test buyer WhatsApp "Hi" → lead + AI reply
Day 7  Owner dashboard shows first visits
Day 30 Review: no support tickets for manual DB edits → peaceful ✓

Ops: Railway GraphQL redeploy after env change
Ops: Vercel deploy frontend with VITE_* vars
Ops: node scripts/production-smoke-test.mjs → 20/20
```

---

## 7. Tests & proof gates

| Gate | Command |
|------|---------|
| Onboarding unit | `OnboardingPage.test.ts` |
| Readiness | `GET /api/readiness` as company_admin |
| Production smoke | `node scripts/production-smoke-test.mjs` |
| Mail + webhook | `backend/scripts/verify-production-mail-and-webhook.mjs` |
| Enterprise exit | `npm run exit-gate` |
| Handset 30-day | Manual checklist in `docs/NECESSARY.md` |
| Deploy | `node scripts/deploy-railway-graphql.mjs` + `vercel deploy --prod` |

---

## 8. Feature flags & env (production checklist)

| Variable | Required value |
|----------|----------------|
| `DATABASE_URL` / `DIRECT_URL` | Supabase/Postgres |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Set |
| `UPSTASH_REDIS_REST_*` | Set for prod scale |
| `RESEND_API_KEY` / `MAIL_FROM` | Verified |
| `FRONTEND_BASE_URL` | `https://biginvesto.online` |
| `OPENAI_API_KEY` | For AI + embeddings |
| `WHATSAPP_*` | Per-tenant in settings (platform defaults removed) |
| `VITE_API_URL` | Railway API URL on Vercel |
| `VITE_CLARITY_PROJECT_ID` | `x9uanyc7kt` |
| `FEATURE_SSO` + `SSO_TEST_IDP` | `true` + **`false`** when Chunk 05 done |

---

## 9. Definition of done

- [ ] New tenant completes onboarding without engineer intervention
- [ ] Readiness green only when WhatsApp + property + agent verified
- [ ] Production smoke 20/20 after every deploy
- [ ] Mail deliverability verified (invite + forgot password)
- [ ] Meta webhook receives test event on new tenant setup
- [ ] Docs point to Railway + biginvesto.online only
- [ ] 30-day checklist in NECESSARY.md signed off for one pilot agency

---

## 10. Rollout (platform-wide)

```
1. Chunk 07 Phase 1-2 → all new tenants
2. Chunks 01-04 → pillar hardening per priority
3. Chunk 05 → enterprise IAM (OIDC)
4. Chunk 06 → analytics performance
5. npm run exit-gate + update CHUNK_STATUS.json
```

**Deploy commands (ops):**

```powershell
$env:RAILWAY_ACCOUNT_TOKEN = '<token>'
node scripts/deploy-railway-graphql.mjs

cd frontend
$env:VITE_CLARITY_PROJECT_ID = 'x9uanyc7kt'
npx vercel deploy --prod --yes
```

---

## Appendix — Cross-pillar enterprise modules (not separate chunks)

These platform capabilities are **enabled via Railway flags** and documented inside the pillar they affect:

| Module | Flag | Primary pillar |
|--------|------|----------------|
| Async WhatsApp | `FEATURE_ASYNC_WHATSAPP_PIPELINE` | 02 |
| Tenant quotas | `FEATURE_TENANT_QUOTAS` | 07 |
| DSR / retention | `FEATURE_DSR`, `FEATURE_COMPLIANCE_RETENTION` | 05, 07 |
| Public API | `FEATURE_PUBLIC_API` | 01, 06 |
| AI governance | `FEATURE_AI_REVIEW_QUEUE` | 02 |
| Billing ops | `FEATURE_BILLING_OPS` | 07 |

Implement and prove these **within** the pillar chunk that owns the user-facing outcome.
