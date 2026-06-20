# Chunk 03 — Property Inventory, Import, Knowledge & Publish

| Field | Value |
|-------|-------|
| Chunk | 03 of 7 |
| Pillar | 3 — Inventory exists and staff/AI can use it |
| Priority | P0 |
| Depends on | Chunk 07 (storage + tenant provisioned) |
| Unblocks | Chunks 02, 04 (AI answers + visit property context) |

---

## 1. Single-feature scope

**One focus only:** Company admins can **load properties** (manual, CSV, spreadsheet, brochure/PDF), **review drafts**, **publish** with media completeness, and expose **verified knowledge** to buyer AI and staff copilot via RAG.

---

## 2. Current state — NOW

### 2.1 Production today (working)

| Capability | Status | Code / route |
|--------------|--------|--------------|
| Property CRUD | ✅ | `property.routes`, `PropertiesPage` |
| Import wizard (simple + spreadsheet) | ✅ | `PropertyImportPage`, `property-import.routes` |
| Draft → publish flow | ✅ | `propertyImport.service`, knowledge gate |
| S3/R2 media upload | ✅ | `storage.service`, `PropertyMediaPanel` |
| Knowledge chunks + embeddings | ✅ | `property_knowledge_chunks`, OpenAI embeddings |
| AI uses published inventory | ✅ | `workflow-engine`, `ai.service`, vector search |
| Extended attributes at publish | ✅ | `FEATURE_EXTENDED_PROPERTY_ATTRS` (default on) |
| Bulk import skip review | ✅ | `FEATURE_BULK_IMPORT_SKIP_REVIEW` (default on) |

### 2.2 Test-only / partial / gaps

| Gap | Impact |
|-----|--------|
| Publish without hero/brochure | Buyer gets text-only (partially gated by media completeness flag) |
| `FEATURE_BULK_PUBLISH_STRICT` | Off — bulk publish may skip knowledge gate |
| Geocoding without Google Maps key | Location fields manual only |
| Property upload public endpoint | `/api/property-imports/uploads` unauthenticated — needs token hardening review |
| Frontend property page tests flaky | CI noise, not prod blocker |

### 2.3 User experience TODAY

| Persona | Experience |
|---------|------------|
| **Company admin** | Upload CSV/brochure → map columns → fix gaps in knowledge wizard → publish. |
| **Agent** | Views properties (read); AI answers buyers from published knowledge. |
| **Buyer (WhatsApp)** | Asks "3BHK price?" → AI pulls RAG chunks + catalog. Wrong data if publish was incomplete. |

---

## 3. Target state — AFTER

### 3.1 Perfect functioning

- No property reaches `published` without **hero image OR brochure PDF** (configurable strict mode).
- Publish triggers embedding index within 60s; WhatsApp AI answers match sheet data within 2 turns.
- Import errors: row/column level report downloadable.
- Copilot `searchPropertyKnowledge` returns same chunks as buyer AI for same query.
- Super-admin cannot accidentally publish to wrong tenant.

### 3.2 User experience AFTER

| Persona | After fix |
|---------|-----------|
| **Admin** | Readiness banner: "3 drafts missing RERA" before go-live. One-click reindex. |
| **Buyer** | Brochure + location pin on first property detail ask. |
| **Agent** | Copilot cites property name + price consistent with Properties page. |

---

## 4. Implementation plan

### Phase 1 — Publish quality (week 1)

| Task | Files |
|------|-------|
| Enforce media completeness on publish | `propertyImport.service.ts`, `fixMdPropertyMediaCompleteness` |
| Enable `FEATURE_BULK_PUBLISH_STRICT` for enterprise tenants | `enterpriseConfig.routes` |
| Reindex job status in UI | `PropertyImportPage`, health dep `property_knowledge_backfill_queue` |

### Phase 2 — Import hardening (week 2)

| Task | Files |
|------|-------|
| Signed upload tokens only (remove anonymous abuse) | `property-import-upload.routes.ts` |
| Row-level CSV error export | `bulk-csv-import.service.ts` |
| Geocoding fallback UX when no API key | `PropertyImportLocationFields.tsx` |

### Phase 3 — AI alignment (week 3)

| Task | Files |
|------|-------|
| Copilot RAG parity test | `copilotPropertyRag`, `verify-property-ai-context.mjs` |
| Expanded prompts rollout metrics | `FEATURE_EXPANDED_PROPERTY_PROMPTS`, shadow mode |

---

## 5. Enterprise hardening

| Control | Requirement |
|---------|-------------|
| Tenant isolation | Properties + drafts scoped by `companyId` |
| Storage | AWS/R2 credentials per env; no cross-bucket paths |
| Audit | `property.published`, `property.import_completed` |
| Virus/size limits | Multer limits on upload routes |
| Secrets | No brochure URLs with long-lived public tokens in logs |

**Kill switch:** `FEATURE_FULL_IMPORT_KNOWLEDGE=false` disables wide CSV indexing (narrow catalog only).

---

## 6. Real-time usage scenarios

```
Admin uploads 40-row CSV at 10:00
  → Draft created → knowledge wizard flags missing amenities
  → Admin fills gaps → Publish at 10:45
  → Embeddings queued → health shows pending: 0 by 10:47
Buyer at 11:00: "What's the carpet area of Tower B?"
  → Vector search + focused property LLM → accurate sqft from sheet
Staff copilot: "Compare Project A and B pricing"
  → searchPropertyKnowledge tool → same chunk IDs as buyer path
```

---

## 7. Tests & proof gates

| Gate | Command |
|------|---------|
| Import extractor | `npx jest src/tests/unit/property-import-extractor.service.test.ts` |
| Publish readiness | `propertyImportPublishReadiness.test.ts` |
| Production upload smoke | `backend/scripts/smoke-property-upload-production.mjs` |
| AI context verify | `backend/scripts/verify-property-ai-context.mjs` |
| Manual | Publish property → ask WhatsApp price → matches dashboard |

---

## 8. Feature flags & env

| Flag | Purpose |
|------|---------|
| `property_management` (tenant) | Module on |
| `FEATURE_FULL_IMPORT_KNOWLEDGE` | Index all CSV columns |
| `FEATURE_EXPANDED_PROPERTY_PROMPTS` | Wider AI context |
| `FEATURE_BULK_PUBLISH_STRICT` | Gate + rollback on index fail |
| `AWS_*` / `R2_*` | Storage backend |

---

## 9. Definition of done

- [ ] Publish blocked when hero+brochure both missing (strict tenant)
- [ ] Handset: buyer property Q&A matches published sheet (3 sample queries)
- [ ] Import 100-row CSV completes with zero silent row drops
- [ ] Production smoke: `GET /properties` 200, `GET /property-projects` 200
- [ ] Health: `property_knowledge_embeddings: ok`

---

## 10. Rollout

1. Enable strict publish on pilot tenant only
2. Reindex all published properties post-deploy
3. Monitor WhatsApp "wrong price" escalations for 7 days
