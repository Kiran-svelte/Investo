# Chunk 14 — Staff WhatsApp Boundary (PART XIII)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | 14 | full.md **PART XIII** — 5 layers |

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `inboundWhatsAppRouting.service.ts` | `findCompanyUserByPhone`, `routeCompanyScopedInbound`, role sets |
| `agent-router.service.ts` | Staff message entry — **not** buyer orchestrator |
| `agent/agent-intent-orchestrator.service.ts` | Intent layer boundaries only if staff-specific |
| `whatsapp.service.ts` | **Only** staff intercept coordination comments — no buyer logic changes |

**Do not refactor** LangGraph tools or full copilot — only ensure **strangers never hit staff** and **staff never hit H2–H9**.

---

## 3. Five layers (full.md)

```
Layer 1: findCompanyUserByPhone (last-10 digit)
Layer 2: visit/call approval interactive intercept (Chunk 01)
Layer 3: routeCompanyScopedInbound → agent_copilot | staff_non_copilot
Layer 4: agent-router deterministic → workflows → intents → LangGraph
Layer 5: Staff dedup locks (if any) — separate from buyer fingerprint
```

---

## 4. RBAC

| Role | Write tools |
|------|-------------|
| sales_agent | assigned leads/visits only |
| viewer | read-only |
| company_admin | company scope |

---

## 5. REMOVE

- Buyer H2 welcome sent to staff phone numbers
- Approval buttons processed as buyer interactive taps

---

## 6. Verification

Staff phone sends "visits today" → copilot reply, not buyer welcome

---

## Next: [chunk-15.md](./chunk-15.md)
