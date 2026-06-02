# Zero UI for buyers

Investo’s **buyer journey is WhatsApp-only**. A buyer does not need a User account, dashboard login, or viewer role.

## Flow

1. **Inbound WhatsApp** → webhook (`/api/webhook` or Green API) creates or updates a **Lead** by phone.
2. **Conversation** stays `ai_active` with customer AI (`whatsapp.service.ts` → `ai.service.ts`).
3. **Qualification, shortlist, visit booking** use interactive buttons and text on WhatsApp (`visitBooking.service.ts`, `scheduleVisitFromWhatsApp`).
4. **Visits** are stored in `visits`; agents see them in the CRM calendar.

## Code paths (no buyer login)

| Action | Entry | Auth |
|--------|--------|------|
| Chat | WhatsApp webhook | None (signature / Green API token) |
| Book visit | Interactive `visit-time-{propertyId}-{slot}` | Lead phone only |
| Shortlist / filters | WhatsApp interactive lists | Lead phone only |
| Nurture follow-ups | `automation.service` → `sendCompanyTextMessage` | None |

## What buyers never need

- `POST /api/auth/login`
- Frontend routes under `/login` or tenant dashboard
- `User` / `viewer` records

## Tenant users vs buyers

- **Agents / admins**: JWT auth, dashboard, property catalog, leads, visits API.
- **Buyers**: `Lead` + `Conversation` + phone; all conversion on WhatsApp.

## Verification

1. Send WhatsApp message to tenant number → AI reply without any web signup.
2. Tap **Book visit** → confirm row in `visits` and agent notification.
3. Grep backend for buyer-facing `authenticate` on webhook/visit-from-WhatsApp paths — should be **none**.
