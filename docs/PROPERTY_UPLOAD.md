# Who can upload properties

| Role | Upload brochure / import | Publish listing | View catalog |
|------|--------------------------|-----------------|--------------|
| **super_admin** (platform) | No — use **Companies** to onboard agencies | No | No tenant CRM |
| **company_admin** | **Yes** — sole publisher for the agency | Yes | Yes |
| **sales_agent** | No | No | Yes (quote to buyers via WhatsApp) |
| **operations** | No | No | Yes |
| **viewer** | No | No | Read-only |
| **Buyer (WhatsApp)** | No account | N/A | AI shortlist only |

## After upload

1. **Company admin** imports media (PDF/images) under **Properties → Import from media**.
2. Extraction runs; admin fills missing fields (city, area, price, BHK, description).
3. If details are incomplete at **review/publish** stage, the uploader gets a **dashboard notification** listing missing fields.
4. Until the catalog is complete, other API areas (leads, visits, etc.) may return **423** — property import routes stay open so the admin can finish.

## Technical notes

- Browser uploads use **API DB storage** by default (`PROPERTY_IMPORT_DB_UPLOAD` not `false`) to avoid R2 CORS failures from Vercel.
- Customer AI only states facts from completed listings + grounded Never-Say-No alternatives.
