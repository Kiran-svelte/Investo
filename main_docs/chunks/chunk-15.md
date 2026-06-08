# Chunk 15 — Integration Proof (PART XVI–XVIII + Production gate)

> **BOUNDARY RULE:** Do not touch other files or lines. Do only what is mentioned in this chunk.

| Chunk | 15 | full.md **PART XVI, XVII, XVIII** — final gate |

---

## 2. Files IN SCOPE

| File | Scope |
|------|-------|
| `backend/scripts/e2e-handset-proof.mjs` | All 28 scenarios — map to handlers in PART XVI |
| `backend/src/tests/unit/*.test.ts` | Only files listed in Chunks 01–14 rollup (fix failures) |
| `CHECKLIST_STATUS.md` | Update E2E + unit CI status |
| `main_docs/chunks/COMPLETION.md` | **CREATE** — sign-off checklist |

**No production code changes** unless fixing test failures discovered in verification — if fix needed, **open sub-chunk PR** referencing original chunk file.

---

## 3. E2E scenario map (must be 28/28)

| Scenario ID | full.md path | Primary handler |
|-------------|--------------|-----------------|
| buyer-01-rapport | PART XVIII happy §1 | H2 |
| buyer-02-qualify | §2 | H4 |
| buyer-03-brochure | §5 | H7 brochure_request |
| buyer-04-price | §4 | H7 price_inquiry |
| buyer-int-filter | PART IV filter | handlePropertyFilter |
| buyer-int-more-info | PART IV | handleMoreInfo |
| buyer-int-call-me | PART VI | handleCallMe |
| buyer-int-book-visit | PART V | handleVisitTimeSlot |
| buyer-06-book | PART V text | H8 pending |
| buyer-07-idempotent | PART XVII #32 | idempotency keys |
| buyer-09-concurrent | PART I §I.6 | queue replay |
| buyer-11-escalate | PART XVIII alt | H9 escalate |
| buyer-12-no-discount | PART XVIII alt | H9 + objection |
| system-takeover-blocks-ai | PART XVIII alt | H1 |
| system-takeover-release | PART XVIII alt | H-start or release |

(Complete list in full.md PART XVI — verify script contains all.)

---

## 4. Trace verification procedure

For each E2E scenario, logs must show:

```
logOutboundBranch('<HandlerId>', ...)
```

Matching PART III handler for that turn. Document mismatches in COMPLETION.md.

---

## 5. Failure matrix spot-check (PART XVII)

Run 40-row matrix — sample 10 critical rows manually after deploy:

- duplicate_message_id
- concurrent_customer_processing
- visit-time-parse-failed
- filter-no-results-alternatives
- pending approval expire
- empty AI output fallback
- confirmed visit change request

---

## 6. Production gate checklist (COMPLETION.md)

- [ ] All chunks 01–14 merged
- [ ] Unit tests: `npm test` green (document count)
- [ ] E2E: 28/28 against production or staging with E2E token
- [ ] Worker process running (`worker.ts`) for jobs Chunk 13
- [ ] Redis required in prod (Chunk 01 queue)
- [ ] WHATSAPP_APP_SECRET set — webhook signature ok
- [ ] No handler order regressions vs PART III.O
- [ ] full.md behavior spot-audited by QA on 5 paths in PART XVIII

---

## 7. Rollback strategy

Feature flags (if any added during chunks) documented per chunk. Full rollback = revert chunk PRs in reverse order 14→01.

---

## 8. Definition of Done (program complete)

When COMPLETION.md signed off, buyer Zero-UI flow matches [full.md](../full.md) for:

- Opening conversation (1st vs nth)
- Property filters + details + brochure
- Call booking approval path
- Visit booking approval path
- Reminders + post-visit follow-up
- Escalation without AI silence
- Takeover + /start reset
- Concurrent message handling

---

**Program start:** [chunk-01.md](./chunk-01.md)
