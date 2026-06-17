# Investo — Production Entry Checklist

Before any feature, fix, or deploy is considered **done**, every section below must pass. Partial work is broken work.

---

## Full-Output Enforcement Checklist

Derived from the `full-output-enforcement` skill. Each row is a **hard gate** — you must be able to point at proof, not describe intent.

### A. Execution Process (Scope → Build → Cross-check)

| # | You must prove | How to prove | Pass criteria |
|---|----------------|--------------|---------------|
| A1 | **Scope locked before coding** | PR description, commit body, or task comment lists every deliverable with a count (e.g. "7 fixes from fix.md", "3 files + 2 tests") | Count is explicit; nothing added later without updating scope |
| A2 | **Every scoped deliverable exists** | `git diff --name-only` + walk the list | Every named file/function/test from scope appears in the diff or repo |
| A3 | **No skeleton-only output** | Code review of changed files | No function bodies that only throw, return stubs, or defer to "later" |
| A4 | **Cross-check against original request** | Side-by-side: user request ↔ diff ↔ tests | Zero missing items; if deferred, user explicitly agreed |

### B. Banned Patterns — Zero Tolerance Audit

Run these from repo root on **changed source files** (exclude `dist/`, lockfiles, generated assets):

```powershell
# B1 — Placeholder comments in code (hard fail)
rg "// \.\.\.|// rest of|// implement here|// TODO|// similar to|// continue pattern|// add more" backend/src frontend/src --glob "!**/dist/**"

# B2 — Ellipsis standing in for omitted code inside blocks
rg "^\s*\.\.\.\s*$" backend/src frontend/src

# B3 — Block comments used as omission
rg "/\* \.\.\. \*/" backend/src frontend/src
```

| # | Banned in prose (agent/PR text) | Pass criteria |
|---|----------------------------------|---------------|
| B4 | "Let me know if you want me to continue" | Absent from PR, commit message, handoff |
| B5 | "For brevity" / "the rest follows the same pattern" / "similarly for the remaining" | Absent when replacing actual content |
| B6 | "I'll leave that as an exercise" | Absent |
| B7 | Describing what code *should* do instead of writing it | Every claimed fix has a corresponding diff hunk |

| # | Banned structural shortcuts | Pass criteria |
|---|----------------------------|---------------|
| B8 | First + last section only, middle skipped | Full file delivered when full file was requested |
| B9 | One example + "repeat for others" | N identical cases → N implementations or one parameterized implementation with N tests |
| B10 | Token-limit pause without marker | If split across turns: ends with `[PAUSED — X of Y complete. Send "continue" to resume from: …]` |

### C. Quick Check (Before Merge / Deploy)

| # | Check | Command / artifact | Pass criteria |
|---|-------|-------------------|---------------|
| C1 | TypeScript compiles | `cd backend && npx tsc --noEmit` | Exit 0 |
| C2 | Affected unit tests pass | `cd backend && npx jest <paths-from-diff> --no-cache` | Exit 0; every new code path has a test or eval |
| C3 | Eval regressions pass | `cd backend && npx jest src/tests/evals/investo-evals.test.ts --no-cache` | Exit 0 when WhatsApp/AI/copilot paths touched |
| C4 | Smoke (~5 min) | `cd backend && npm run smoke` | Exit 0; hits health + deterministic critical paths |
| C5 | No secrets in diff | `git diff` manual scan | No tokens, `.env` values, Railway keys in committed files |
| C6 | Deploy matches commit | `node scripts/deploy-railway-graphql.mjs` then `curl https://investo-backend-production.up.railway.app/api/health/live` | Deploy SUCCESS; health `{"status":"ok"}` |
| C7 | Handset / E2E when UX changed | `backend/scripts/e2e-handset-proof.mjs` or manual WhatsApp steps documented in PR | Staff + buyer paths verified on real numbers |

### D. Per-Change Proof Matrix (Investo-specific)

When the change touches the area, **all** rows for that area must pass — not just the happy path.

| Area | Must prove | Test / script / manual step |
|------|------------|------------------------------|
| Bulk send | Every parsed phone receives message (staff + client + unknown) | `npx jest src/tests/unit/staffMessageForward.service.test.ts src/tests/unit/agent-intent-orchestrator.service.test.ts`; manual: `Send 'hello' to <staff>, <client>` |
| Post-visit buyer UX | Visited lead gets post-visit buttons, not re-qualification | `npx jest src/tests/unit/buyerLeadProgress.util.test.ts src/tests/unit/buyerButtonPolicy.service.test.ts src/tests/unit/buyerQualification.advancedLead.test.ts`; manual: visited lead sends `Hi` → Share Feedback / Talk to Agent |
| Advanced lead stage | CRM `visited` skips H4 budget/area re-ask | `buyerQualification.advancedLead.test.ts` + eval `buttonPolicy.eval.ts` |
| Staff copilot buttons | Deterministic fallback when LLM returns null | `npx jest src/tests/unit/copilotShortcut.util.test.ts src/tests/evals/staffCopilot.eval.ts` |
| Feature flags | Kill switch works; off = old behavior | Set `FEATURE_ADVANCED_LEAD_UX=false` etc.; `npx jest src/tests/unit/featureRollout.util.test.ts src/tests/unit/featureShadow.util.test.ts` |
| Shadow mode | New vs old logged on mismatch; user gets old | `FEATURE_SHADOW_MODE=true`; inspect logs for `shadowCompare` warnings |
| Gradual rollout | Stable hash per leadId | `FEATURE_ROLLOUT_PERCENTAGE=50`; same lead always same bucket |
| Tenant isolation | Queries scoped by `company_id` | Every new DB query in diff includes tenant filter |
| Staff vs buyer routing | No session contamination | `npx jest src/tests/unit/inbound-whatsapp-routing.viewer.test.ts` |
| Viewer role | Read-only staff cannot execute mutations | `agent-intent-orchestrator` viewer tests |

### E. Definition of Done (single checklist block)

Copy into PR / handoff and tick every box:

```
[ ] A1–A4  Scope locked, built completely, cross-checked
[ ] B1–B3  rg placeholder audit clean on changed src files
[ ] B4–B10 No banned prose or structural shortcuts
[ ] C1     tsc --noEmit
[ ] C2     jest on affected paths
[ ] C3     investo-evals (if AI/WhatsApp/copilot touched)
[ ] C4     npm run smoke
[ ] C5     no secrets in commit
[ ] C6     Railway deploy SUCCESS + health ok
[ ] C7     manual WhatsApp verification (if user-visible UX)
[ ] D      all applicable per-change matrix rows
```

**Rule:** If any box is unchecked, the task is not done. Do not ship partial output.

---

## Multi-Tenant Architecture (Global — Done Once)

These guarantees apply to every feature automatically once implemented.

| Global rule | What it means | How to implement once |
|-------------|---------------|------------------------|
| Tenant isolation | Every DB table has `company_id`; every query filters by it | Database schema + middleware |
| Role permissions | `sales_agent`, `company_admin`, `super_admin` have defined capabilities | RBAC service + guards |
| Authentication | Every API request identifies the user and their tenant | JWT middleware |
| Audit logging | Every action logs `company_id`, `user_id`, `action`, `timestamp` | Global log interceptor |
| Feature flagging | Ability to enable/disable features per tenant | `company_settings` + `config.features` + env vars |
| Idempotency | Duplicate requests blocked at API or mutation level | Global request deduplication middleware |

Env vars for UX kill switches (backend `config.features`):

| Env var | Default | Controls |
|---------|---------|----------|
| `FEATURE_ADVANCED_LEAD_UX` | `false` | Post-visit buttons, stage sync, skip re-qualification |
| `FEATURE_CONTEXTUAL_COPILOT_BUTTONS` | `false` | Deterministic staff copilot button fallback |
| `FEATURE_CUSTOM_GREETING_TEMPLATE` | `false` | H2 custom greeting template path |
| `FEATURE_ROLLOUT_PERCENTAGE` | `0` | 0–100 gradual rollout by stable lead hash |
| `FEATURE_SHADOW_MODE` | `false` | Run new+old in parallel; log mismatches; return old |

---

## Per-Feature Validation (Every New Feature)

Even with global rules, each feature needs its own proof.

| Per-feature check | Why | Example: bulk send |
|-------------------|-----|---------------------|
| Permission check | Role gating | Requires `company_admin`; `schedule_visit` may need only `sales_agent` |
| Tenant scoping | No cross-company data leak | Only targets leads from staff's `company_id` |
| Feature flag | Toggle per tenant | Some agencies disable bulk messaging |
| Rate limiting | Abuse prevention | Stricter limits than single messages |
| Idempotency key | Duplicate harm | Duplicate bulk send must not double-deliver |
| Audit log entry | Forensics | Every bulk send logged with recipients + message hash |
| Error handling | Actionable failures | "No WhatsApp number configured" surfaced clearly |
| Full-output compliance | No partial ship | Section E checklist complete for this feature |

---

## Original Production Proof Areas

1. **Tenant Isolation (Data Separation)**
2. **Permission Scoping (Role per Tenant)**
3. **Feature Availability per Tenant (Plans / Settings)**
4. **WhatsApp Phone Number & Token per Tenant**
5. **Audit Logging (Prove What Happened)**
6. **Positive & Negative Test Scenarios**
7. **Debugging Two Staff Accounts (Inconsistency Resolution)**
8. **Automated Regression Tests (CI)**
9. **Production Monitoring (Prove Continuously)**

Each item above must link to: automated test(s), smoke step, or runbook — not documentation alone.
