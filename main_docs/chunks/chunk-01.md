# Chunk 01 — Lead Capture, Assignment & Pipeline Ownership

| Field | Value |
|-------|-------|
| Chunk | 01 of 7 |
| Pillar | 1 — Lead comes in → someone owns it |
| Priority | P0 |
| Depends on | Chunk 07 (tenant live on WhatsApp) |
| Unblocks | Chunks 02, 04, 06 |

---

## 1. Single-feature scope

**One focus only:** Every inbound buyer signal becomes a **tenant-scoped lead** with an **owner**, **status**, and **audit trail** — from WhatsApp webhook, manual create, CSV import, or API — with no orphan or cross-tenant rows.

Out of scope for this chunk: conversation UI (Chunk 02), visit booking (Chunk 04), SSO (Chunk 05).

---

## 2. Current state — NOW

### 2.1 Production today (working)

| Capability | Status | Code / route |
|--------------|--------|--------------|
| WhatsApp inbound → lead create | ✅ | `webhook.routes`, `inboundWhatsAppRouting.service` |
| Manual lead CRUD | ✅ | `GET/POST/PATCH /api/leads` |
| Status pipeline | ✅ | `leadStatus.config.ts`, `LeadStatusSelect` |
| Agent assignment (manual + round-robin) | ✅ | `assignment-settings.routes`, `LeadsPage` |
| Tenant isolation on leads | ✅ | `strictTenantIsolation`, lead tests |
| Super-admin tenant switch | ✅ | `?target_company_id=` query param |
| Lead detail + notes + memory | ✅ | `LeadDetailPage`, `lead_memory` JSON |

### 2.2 Test-only / partial / gaps

| Gap | Impact | Severity |
|-----|--------|----------|
| Demo credentials stale (`admin@demorealty.in`) | Smoke/docs confusion | Medium |
| Staff phone = buyer phone collision | Session contamination | High |
| Re-engagement cron depends on Redis | Missed follow-ups if Redis down | Medium |
| Bulk CSV import error UX | Admin retries without clear row errors | Low |
| Public API lead create (`FEATURE_PUBLIC_API`) | Off by default — not enterprise ingress | Low |

### 2.3 User experience TODAY

| Persona | Experience |
|---------|------------|
| **Buyer (WhatsApp)** | Messages business number → lead auto-created → AI replies. Returning buyer may get wrong greeting if history mishandled (see `fix.md`). |
| **Sales agent** | Opens `/dashboard/leads` → filters → opens lead → updates status. Gets 400 if super_admin forgot tenant context. |
| **Company admin** | Creates/edits leads, assigns agents, configures round-robin in Settings. |
| **Super admin** | Must pick tenant in switcher before CRM data loads. |

---

## 3. Target state — AFTER

### 3.1 Perfect functioning

- 100% inbound WhatsApp messages attach to **correct tenant** and **correct or new lead** within 3s webhook ack.
- **Zero** cross-tenant lead reads/writes (proven by matrix test + quarterly re-run).
- Staff/buyer phone collision **logged + alerted** to company_admin; copilot does not leak buyer thread.
- Returning buyers (2+ prior AI messages) **never** get first-time onboarding greeting.
- Assignment rules applied on create **and** on re-opened stale leads.
- Lead list loads < 2s p95 for 5k leads/tenant (indexed queries).

### 3.2 User experience AFTER

| Persona | After fix |
|---------|-----------|
| **Buyer** | "Hi" after prior chat continues property thread; budget/area remembered in `lead_memory`. |
| **Agent** | New lead appears in list + notification within seconds; status dropdown always reflects legal transitions. |
| **Admin** | Import 500-row CSV with row-level error report; round-robin preview before save. |
| **Owner** | Dashboard "new leads today" matches WhatsApp reality (no phantom rows). |

---

## 4. Implementation plan

### Phase 1 — Correctness & isolation (week 1)

| Task | Files |
|------|-------|
| Harden staff/buyer phone collision alert | `buyerAgentAssist.service.ts`, `notification.engine.ts` |
| Returning buyer greeting guard | `customerMessageFastPath.service.ts`, `buyerQualification.*` |
| Super-admin smoke: auto `target_company_id` | `scripts/production-smoke-test.mjs` ✅ done |
| Re-engagement cron Redis fallback log | `cron-scheduler.service.ts`, `readiness.service.ts` |

### Phase 2 — Assignment & import UX (week 2)

| Task | Files |
|------|-------|
| Round-robin dry-run API | `assignment-settings.routes.ts` |
| CSV import row errors in UI | `bulk-csv-import.service.ts`, `LeadsPage` |
| Lead create idempotency on phone dedup | `lead.routes.ts`, Prisma unique index verify |

### Phase 3 — Enterprise ingress (week 3, optional)

| Task | Files |
|------|-------|
| Public API lead create behind API key | `publicApi.routes.ts`, `IntegrationsPage` |
| Webhook outbound on `lead.created` | `outbox.service.ts` if `FEATURE_OUTBOX_EVENTS` |

---

## 5. Enterprise hardening

| Control | Requirement |
|---------|-------------|
| Tenant isolation | Every `prisma.lead.*` query includes `companyId` from `getCompanyId(req)` |
| Audit | `lead.created`, `lead.assigned`, `lead.status_changed` in `audit_logs` |
| PII | Phone encrypted when `FEATURE_PII_ENCRYPTION=true` |
| Rate limits | Webhook + user rate limiters on `/api/leads` mutations |
| Quotas | `FEATURE_TENANT_QUOTAS` — warn then hard-enforce lead count if configured |

**Kill switch:** `FEATURE_LEAD_AUTOMATION=false` (tenant feature flag) disables auto-create from WhatsApp for one company without code deploy.

---

## 6. Real-time usage scenarios

```
09:00  Buyer sends "2BHK Whitefield 80L" on WhatsApp
09:00  Meta webhook → queue (async) or inline handler
09:01  Lead created/updated, AI reply sent
09:01  Socket event → agent dashboard notification (if connected)
09:05  Agent opens lead on phone copilot OR /dashboard/leads
09:10  Admin assigns round-robin if unassigned
```

**Cron (background):** `processDueFollowUps` every 15m — re-engage cold leads per automation rules.

---

## 7. Tests & proof gates

| Gate | Command / check |
|------|-----------------|
| Tenant matrix | `npx jest src/tests/integration/tenantIsolation.matrix.test.ts --runInBand` |
| Lead boundary | `npx jest src/tests/unit/lead-tenant-boundary.test.ts` |
| Returning buyer | `npx jest src/tests/unit/buyerStartFresh.service.test.ts` |
| Production smoke | `node scripts/production-smoke-test.mjs` → `GET /leads` 200 |
| Handset | `backend/scripts/e2e-handset-proof.mjs` — inbound creates lead |
| Manual | Create lead → assign → status change → visible on dashboard |

---

## 8. Feature flags & env

| Flag | Default | Purpose |
|------|---------|---------|
| `lead_automation` (tenant) | on | WhatsApp auto-lead |
| `FEATURE_FIX_MD_RETURNING_BUYER_STAGE` | on | Skip rapport re-interrogation |
| `FEATURE_FIX_MD_STAFF_BUYER_COLLISION_LOG` | on | Collision structured log |
| `FEATURE_TENANT_QUOTAS` | Railway: on | Usage metering |
| `FEATURE_QUOTA_HARD_ENFORCE` | off | Set true after soak |

---

## 9. Definition of done

- [ ] Handset proof: inbound WhatsApp → lead row within 60s on production tenant
- [ ] No cross-tenant leak in isolation matrix (100% pass)
- [ ] Returning buyer "Okay" does not reset to welcome greeting
- [ ] Staff/buyer phone collision produces admin-visible alert
- [ ] Production smoke: leads endpoint 200 with tenant context
- [ ] Audit log entry for assignment + status change verifiable in `/dashboard/audit-logs`

---

## 10. Rollout

1. Deploy backend fixes → Railway GraphQL redeploy
2. Run smoke + one real handset message on pilot tenant
3. Enable `FEATURE_QUOTA_HARD_ENFORCE` only after 2 weeks warn-only metrics
4. Document live credentials in ops runbook (not stale demo emails)
