# Chunk 05 — Team Access: Roles, Invites, MFA, SSO & SCIM

| Field | Value |
|-------|-------|
| Chunk | 05 of 7 |
| Pillar | 5 — Team logs in with clear roles |
| Priority | P1 |
| Depends on | Chunk 07 (mail + tenant exists) |
| Unblocks | Enterprise sales, compliance audits |

---

## 1. Single-feature scope

**One focus only:** Agency teams **authenticate securely**, receive **role-appropriate access**, and (for enterprise tenants) sign in via **corporate IdP** with optional **MFA** and **SCIM provisioning** — without breaking password login for small agencies.

---

## 2. Current state — NOW

### 2.1 Production today (working)

| Capability | Status | Code / route |
|--------------|--------|--------------|
| Email/password login | ✅ | `POST /api/auth/login` |
| JWT + httpOnly cookies | ✅ | `authSessionCookies.util.ts` |
| Refresh token rotation | ✅ | `auth.service.ts` |
| Roles (super_admin, company_admin, sales_agent, operations, viewer) | ✅ | `rbac.ts`, `navigation.config.ts` |
| Invite accept flow | ✅ | `/accept-invite/:token` |
| Forgot-password email (Resend) | ✅ | `email.service.ts`, mail health ok |
| MFA TOTP enroll + verify | ✅ | `mfa.service.ts`, `FEATURE_MFA=true` |
| SSO test IdP | ✅ | `SSO_TEST_IDP=true` — fake callback |
| SCIM routes | ✅ | `/scim/v2`, token rotation in Security Settings |
| Org branches | ✅ | `FEATURE_ORG_BRANCHES`, `BranchesPage` |
| IP allowlist middleware | ✅ | When `FEATURE_IP_ALLOWLIST=true` |
| Security Settings UI | ✅ | `/dashboard/security` |

### 2.2 Test-only / partial / NOT production

| Gap | Impact | Severity |
|-----|--------|----------|
| **`SSO_TEST_IDP=true`** | No real Google/Okta/Azure login | **Critical for enterprise** |
| **OIDC callback returns 501** | Authorize redirect works; return path broken | **Critical** |
| No `sso_oidc_client_secret` in schema | Cannot complete token exchange | High |
| Security UI missing OIDC issuer/client fields | Admin cannot self-serve IdP config | High |
| Demo credentials stale in docs | Onboarding confusion | Medium |
| SAML / WorkOS | Never built | Enterprise blocker for some RFPs |
| WebAuthn MFA | Schema only; TOTP only | Medium |
| Neon Auth parallel path | Optional; not primary | Low |
| Jest ESM failures on MFA route tests | CI red; prod MFA works | Medium |

### 2.3 User experience TODAY

| Persona | Experience |
|---------|------------|
| **Company admin** | Password login → onboarding if incomplete. Can toggle SSO/MFA in Security Settings but cannot enter OIDC URLs in UI. |
| **Agent** | Password login; MFA if company requires and device enrolled. |
| **Enterprise IT** | Cannot complete real OIDC; test SSO only for pre-provisioned emails. |
| **Super admin** | Password login; bypasses company MFA policy by design. SSO test works for `big.investo.sol@gmail.com`. |

---

## 3. Target state — AFTER

### 3.1 Perfect functioning

- **Small agency:** Invite → temp password email → login → forced password change → role-scoped dashboard.
- **Enterprise agency:** Email domain → redirect to Google Workspace/Okta → OIDC callback → session cookies → dashboard. JIT or invite-first per policy.
- **MFA required:** Login returns `mfa_required` → enroll or verify TOTP → then session.
- **SCIM:** IdP provisions users → appear in Agents page → SSO login links `external_id`.
- **Branches:** User assigned to branch → data scoped where configured.
- **IP allowlist:** Dashboard API blocked outside office CIDR with clear error.

### 3.2 User experience AFTER

| Persona | After fix |
|---------|-----------|
| **Admin** | Security Settings: SSO wizard (issuer, client ID, secret, test connection, allowed domains). |
| **Agent** | "Sign in with company SSO" on login page works for `@company.com`. |
| **IT admin** | SCIM endpoint docs + token + audit log of provision events. |
| **Super admin** | Always local password + MFA; never SSO (platform policy). |

---

## 4. Implementation plan

### Phase 1 — Production OIDC (weeks 1–2) **CRITICAL**

| Task | Files |
|------|-------|
| Add `ssoOidcClientSecretEnc` to schema + migration | `schema.prisma`, `identityConfig.service` |
| Implement authorization code exchange | `sso.service.ts`, `sso.routes.ts` |
| State/nonce validation (Redis or signed cookie) | new `ssoState.service.ts` |
| OIDC discovery or configurable token endpoint | `sso.service.ts` |
| Map `sub`, `email`, `name` claims → `completeCallback()` | `sso.service.ts` |
| Set `SSO_TEST_IDP=false` on Railway after proof | env |

### Phase 2 — Admin UX (week 3)

| Task | Files |
|------|-------|
| OIDC fields + "Test connection" in Security Settings | `SecuritySettingsPage.tsx`, `identity-settings.routes` |
| Login page domain hint → auto SSO when domain matches | `LoginPage.tsx`, `SsoLoginPage.tsx` |
| Document redirect URI for IT admins | inline help + `docs/enterprise/SSO_SETUP.md` |

### Phase 3 — SCIM + MFA hardening (week 4)

| Task | Files |
|------|-------|
| SCIM e2e with Okta/Azure test tenant | `scim.routes.ts`, integration test |
| MFA enforce rollout playbook | `SecuritySettingsPage`, company `mfa_required` |
| Fix Jest ESM for otplib | `jest.config`, transformIgnorePatterns |
| Optional: WorkOS adapter | new `identity/sso/workos.provider.ts` |

### Phase 4 — Branches & IP (week 5)

| Task | Files |
|------|-------|
| Branch assignment on invite/user edit | `AgentsPage`, `user.routes` |
| Verify branch scoping on leads list | `lead.routes`, `branch.routes` |
| IP allowlist enforcement audit | `ipAllowlist.ts` middleware tests |

---

## 5. Enterprise hardening

| Control | Requirement |
|---------|-------------|
| CSRF | SSO `state` param validated on callback |
| Secret storage | Client secret encrypted at rest (`PII_ENCRYPTION_KEY`) |
| Audit | `sso_login`, `mfa_enrolled`, `scim.user_created` |
| Session | HttpOnly, Secure, SameSite=None in prod |
| Super admin | No SSO; platform accounts isolated |
| Rate limit | `sensitiveRateLimiter` on `/api/auth/*` |
| Compliance | DSR export includes user identity records |

**Kill switches:**

- `FEATURE_SSO=false` — password only globally
- `SSO_TEST_IDP=true` — dev/staging only (never enterprise demo)
- Company `sso_enabled=false` — per-tenant off

---

## 6. Real-time usage scenarios

```
Enterprise new hire (invite-first):
  IT creates user in Okta → SCIM POST /scim/v2/Users → Investo user row
  User visits biginvesto.online/login → SSO → Google → callback → /dashboard

Enterprise JIT:
  First SSO login from @acme.com → user created as viewer → admin promotes role

MFA enforce:
  Login password ok → mfa_required → Authenticator app → verify → cookies set

Small agency:
  Admin invites rahul@agency.in → Resend email → temp password → /change-password → /onboarding
```

---

## 7. Tests & proof gates

| Gate | Command / check |
|------|-----------------|
| MFA unit | `npx jest src/tests/unit/mfa.service.test.ts` |
| SSO unit | `npx jest src/tests/unit/sso.service.test.ts` |
| RBAC | `npx jest src/tests/unit/rbac.test.ts` |
| Forgot password | `npx jest src/tests/unit/auth.routes.forgot-password.test.ts` (after ESM fix) |
| Production | SSO start → real IdP → callback → `/auth/me` 200 |
| Production | Forgot password email received in inbox < 60s |
| SCIM | Post user → GET Agents list contains email |
| Manual | IP allowlist block from non-allowed IP → 403 |

---

## 8. Feature flags & env

| Variable | Production target |
|----------|-------------------|
| `FEATURE_SSO` | `true` |
| `FEATURE_MFA` | `true` |
| `FEATURE_SCIM` | `true` |
| `FEATURE_ORG_BRANCHES` | `true` |
| `FEATURE_IP_ALLOWLIST` | `true` (per company opt-in) |
| `SSO_TEST_IDP` | **`false`** |
| `SSO_CALLBACK_BASE_URL` | Railway backend URL |
| `FRONTEND_BASE_URL` | `https://biginvesto.online` |
| `MFA_ENCRYPTION_KEY` | 32+ byte secret |
| `RESEND_API_KEY` + `MAIL_FROM` | Verified sender |

---

## 9. Definition of done

- [ ] Google Workspace OIDC login works end-to-end on staging
- [ ] `SSO_TEST_IDP=false` in production
- [ ] Security Settings saves issuer + client + secret
- [ ] MFA required company blocks dashboard until TOTP verified
- [ ] SCIM create user → login via SSO → same `external_id`
- [ ] Super admin still password-only
- [ ] Production smoke: login + `/auth/me` 200
- [ ] No OIDC secrets in logs or client bundle

---

## 10. Rollout

1. Ship OIDC callback to staging with test Google OAuth app
2. One pilot customer domain (allowlist + SSO enabled)
3. IT sign-off on SCIM + SSO runbook
4. Flip production `SSO_TEST_IDP=false`
5. Update all docs: live super admin email, remove stale demo passwords
