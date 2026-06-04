# Investo — Master Implementation Spec (PO / FDE)

**Version:** 1.0.0  
**Rule:** No spec → no build. Phases are sequenced by **money** (what makes the product sellable in India RE WhatsApp).

---

## Level 1 — The building

| ID | Decision | Investo choice |
|----|----------|----------------|
| L1-01 | Product | Multi-tenant SaaS RE WhatsApp AI + CRM |
| L1-02 | Primary channel | Meta WhatsApp Cloud API (Green API optional per tenant) |
| L1-03 | Inventory truth | Tenant `properties` table only in Phase 1–3 |
| L1-04 | Conversion north star | **Site visit booked** in `visits` table |
| L1-05 | AI posture | **Never dead-end** on tenant inventory (Phase 1); partners/portals Phase 4+ |

---

## Level 2 — Departments & gap closure map

| Dept | Module | Was | Phase | Spec doc section |
|------|--------|-----|-------|------------------|
| D01 | WhatsApp | Partial | P0–P1 | §D01 |
| D02 | AI + conversion | Partial | P0–P2 | §D02 |
| D03 | Property catalog | Partial | P1 | §D03 |
| D04 | Leads CRM | Yes | P1 harden | §D04 |
| D05 | Visits / calendar | **Partial** | **P0** | §D05 |
| D06 | Agents | Yes | P0 | §D06 |
| D07 | Automation / nurture | Partial | **P0** | §D07 |
| D08 | Admin / AI settings | Partial | P2 | §D08 |
| D09 | Partners / portals | No | P4 | §D09 |
| D10 | XR / crypto / blockchain | No | **Out of scope** | — |

---

## §D05 — Visits (P0 — MUST WORK)

### Component: `visitBooking.service.scheduleFromWhatsApp`

| Field | Spec |
|-------|------|
| Input | `companyId`, `leadId`, `propertyId`, `scheduledAt`, `durationMinutes=60` |
| Agent | `lead.assignedAgentId` OR `assignLeadRoundRobin(companyId)` |
| Conflict | Same as REST: 60 min buffer, no past dates |
| DB | `INSERT visits`; lead → `visit_scheduled` (from `new` or `contacted`) |
| Notify | `notificationEngine.onVisitScheduled` |
| WhatsApp | Confirmation message with property, date, agent name |
| Bug fix | Parse `visit-time-{uuid}-{slot}` without splitting UUID on `-` |

### Acceptance test

1. Customer taps Book Visit → time slot → row in `visits` + calendar UI shows it.  
2. Agent receives notification.  
3. 24h/1h reminders fire from `visits.scheduledAt`.

---

## §D02 — Never-Say-No (tenant inventory) (P0–P1)

### Priority stack (code-enforced)

1. **Exact match** — BHK, area, type, budget on `properties`  
2. **Upsell** — +1 BHK same area, price delta in copy  
3. **Nearby area** — same city, different `locationArea`  
4. **Budget stretch** — expand `priceMax` by 15%  
5. **Type pivot** — apartment ↔ villa in same city  
6. **Waitlist** — store in `conversation.commitments.waitlist=true` + confirm message  
7. **EMI bridge** — `calculateEmi` when budget low vs cheapest unit  
8. **Partner / portal / fractional** — Phase 4 (config stub in `company.settings.conversion`)

### Component: `alternativeInventory.service`

| Function | Output |
|----------|--------|
| `searchExact(criteria)` | 0–10 properties |
| `searchAlternatives(criteria)` | Tiered `AlternativeTier[]` with `messageHint` |
| `formatAlternativesForPrompt(tiers)` | Text block for AI system prompt |

### Component: `conversionEngine.service`

| Function | Behavior |
|----------|----------|
| `buildContext(companyId, lead)` | Runs search + alternatives; returns `conversionPromptBlock` |
| Rule | AI must not say "we don't have" without listing tier 1–6 options |

### Acceptance test

1. No 2BHK Whitefield → returns 3BHK or Koramangala tier with hints.  
2. Budget ₹50L no unit → EMI + stretch tier messages.  
3. Filter buttons with 0 results → alternatives sent, not generic apology only.

---

## §D07 — Nurture ladder (P0)

| Job type | Trigger | Message intent |
|----------|---------|----------------|
| `lead_follow_up_48h` | contacted, idle 48h | Re-engage (existing) |
| `lead_nurture_3d` | not closed, idle 72h | "3 new matches" |
| `lead_nurture_7d` | not closed, idle 7d | Market urgency (area from lead) |
| `lead_nurture_30d` | not closed, idle 30d | Soft revisit |
| `lead_follow_up_7d` | negotiation 7d | Agent reminder (existing) |

| Field | Spec |
|-------|------|
| Dedup | `uniqueKey` per lead per job type |
| Opt-out | If lead status `closed_lost` / conversation `closed` → skip |
| Languages | en, hi, kn minimum templates |

---

## §D01 — WhatsApp media (P1)

| Action | Spec |
|--------|------|
| sendImage / sendDocument / sendLocation | Meta path required; log failure |
| After shortlist | Auto-send images + brochure when URLs exist |
| Green API | Document "not supported" → fallback text with URL |

---

## §D09 — Partners & portals (P4 — NOT Phase 1)

| Feature | Spec when built |
|---------|-----------------|
| Partner CRM API | `company.settings.conversion.partners[]` |
| Referral fee | `referrals` table |
| MagicBricks / 99acres | Webhook or scrape adapter — legal review required |

---

## Implementation phases (execution order)

### Phase 0 (this sprint) — **Sellable core**

- [x] Spec documents  
- [x] `visitBooking.service` + WhatsApp UUID fix  
- [x] `alternativeInventory.service` + `conversionEngine.service`  
- [x] AI path uses matched properties + conversion block  
- [x] Filter no-results uses alternatives  
- [x] Nurture 3d / 7d / 30d jobs (en/hi/kn)  
- [x] Unit tests for visit booking + alternatives  

### Phase 1 — Hardening

- [x] WhatsApp media E2E  
- [x] Lead state machine enforcement on all paths  
- [x] Post-visit follow-up (existing partial) verified  

### Phase 2 — Admin & config

- [x] Company conversion settings UI (upsell %, stretch %, waitlist copy, business type, portal/competitor toggles)  
- [x] Partner list CRUD (manual) + Never-Say-No engine (46-scenario prompt + post-LLM guard + cross-channel email)  

### Phase 3 — Enterprise

- [ ] Tenant isolation test suite  
- [ ] Load test webhook  

### Phase 4 — Market expansion (optional product line)

- [ ] Partner inventory API  
- [ ] Portal adapters  

---

## Sign-off

| Role | Phase 0 approved |
|------|------------------|
| PO | ☐ |
| Tech lead | ☐ |

**Developer rule:** Implement only rows checked in the current phase.

**Manual E2E:** See `docs/USER_JOURNEY.md`.  
**Full test matrix:** `node scripts/run-full-test-matrix.mjs` (set `E2E_SKIP=1` to skip Playwright).
