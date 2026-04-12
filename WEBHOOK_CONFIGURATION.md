# Webhook Configuration (Meta + GreenAPI)

This backend supports two WhatsApp integration tracks:

- **Meta (WhatsApp Cloud API)** — supported in production.
- **GreenAPI** — **non-production only** (dev/testing).

## Dual-track provider policy

- **Production** (`NODE_ENV=production`): **Meta only**. Setting `WHATSAPP_PROVIDER=greenapi` **fails server boot**.
- **Non-production**: `WHATSAPP_PROVIDER` may be `meta` (default) or `greenapi`.

## Meta webhook (WhatsApp Cloud API)

**Endpoints**

- `GET /api/webhook` — verification (echoes `hub.challenge`)
- `POST /api/webhook` — inbound webhook events

**Callback URLs (examples)**

- Production: `https://investo-backend-v2.onrender.com/api/webhook`
- Local dev: `http://localhost:3001/api/webhook` (default backend port is `3001`; use your `PORT` if different)

**Verification**

Configure these values in Meta:

```
Callback URL: <YOUR_BACKEND_BASE_URL>/api/webhook
Verify Token: <WHATSAPP_VERIFY_TOKEN>
```

Meta will call:

```
GET /api/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
```

**Signature security (Meta)**

- Production requires a valid `X-Hub-Signature-256` header computed with `WHATSAPP_APP_SECRET`.
- In non-production, the server allows missing `WHATSAPP_APP_SECRET` and/or missing signature header for local testing.

**Optional hardening (Meta)**

- `WHATSAPP_IP_WHITELIST_ENABLED=true` — allow only Meta IP ranges.
- `SKIP_IP_WHITELIST=true` — development-only bypass.

**Meta env vars (typical)**

```bash
WHATSAPP_VERIFY_TOKEN=investo_webhook_verify_token
WHATSAPP_APP_SECRET=<META_APP_SECRET>          # required in production
WHATSAPP_ACCESS_TOKEN=<META_ACCESS_TOKEN>
WHATSAPP_PHONE_NUMBER_ID=<META_PHONE_NUMBER_ID>

WHATSAPP_IP_WHITELIST_ENABLED=true             # optional hardening
SKIP_IP_WHITELIST=true                         # dev-only
```

**Local dev helper (Meta)**

`POST /api/webhook/test` is available only when `NODE_ENV=development`.

```bash
POST http://localhost:3001/api/webhook/test
Content-Type: application/json

{
  "phone": "+919876543210",
  "name": "Test Customer",
  "message": "I want to buy a property in Bangalore"
}
```

## GreenAPI webhook (non-production only)

**When it exists**

The GreenAPI route is mounted only when both conditions are true:

- `NODE_ENV != production`
- `WHATSAPP_PROVIDER=greenapi`

**Endpoint**

- `POST /api/greenapi/webhook`

**Authorization (required)**

Requests must include an `Authorization` header whose token matches `GREENAPI_WEBHOOK_URL_TOKEN`.

Accepted header formats:

- `Authorization: Bearer <token>`
- `Authorization: Basic <token>`
- `Authorization: <token>`

**Required env vars (GreenAPI mode)**

```bash
WHATSAPP_PROVIDER=greenapi

GREENAPI_API_URL=https://api.green-api.com     # optional (defaults to this)
GREENAPI_ID_INSTANCE=<YOUR_ID_INSTANCE>
GREENAPI_API_TOKEN_INSTANCE=<YOUR_API_TOKEN_INSTANCE>
GREENAPI_WEBHOOK_URL_TOKEN=<YOUR_WEBHOOK_SHARED_SECRET>
```

## Critical mapping requirement (GreenAPI inbound routing)

GreenAPI inbound webhooks are **multi-tenant routed** by instance identifier:

- The backend extracts the instance identifier from the webhook payload (`instanceData.idInstance`, falling back to `wid`).
- It routes the inbound message to a company by matching:

```
payload.instanceData.idInstance  ==  company.settings.whatsapp.phoneNumberId
```

**Fail-closed behavior**

- If the webhook has **no** instance identifier (or multiple different instance identifiers in the same request), the endpoint responds `422` and the message is **not processed**.
- If **no company** is mapped for the instance identifier, the endpoint responds `404` and the message is **not processed**.

Keep this mapping **unique per active company**.

### How to set `company.settings.whatsapp.phoneNumberId`

- **Preferred (UI)**: In the frontend **AI Settings** page, set **Phone Number ID** to your GreenAPI `GREENAPI_ID_INSTANCE` for that company, then save.
- **Fallback (DB JSON)**: Update the company `settings` JSON to include:

```json
{
  "whatsapp": {
    "phoneNumberId": "<YOUR_GREENAPI_ID_INSTANCE>"
  }
}
```

## Limitations

- GreenAPI is **dev/testing only** (enforced: cannot run when `NODE_ENV=production`).
- GreenAPI inbound processing is **text-only** (non-text message types are skipped).
- GreenAPI outbound sending supports **text messages only**; Meta-only rich media/interactive features are not supported in GreenAPI mode.

## QUICK START GUIDE

### For Immediate Testing (No Meta Setup):

```bash
# 1. Start backend locally
cd D:\Investo\backend
npm run dev

# 2. Login to get token
POST http://localhost:3000/api/auth/login
{
  "email": "admin@investo.in",
  "password": "admin@123"
}

# 3. Test WhatsApp flow
POST http://localhost:3000/api/webhook/test
Authorization: Bearer <token_from_step_2>
{
  "phone": "+919876543210",
  "message": "I want 3BHK apartment under 1 crore"
}

# 4. Check result
GET http://localhost:3000/api/leads
Authorization: Bearer <token>
```

### For Production (Requires Meta Setup):

1. Create Meta Business Manager account
2. Add WhatsApp Business API
3. Get Phone Number ID and Access Token
4. Configure webhook in Meta with URL and verify token
5. Set environment variables in Render
6. Redeploy backend
7. Send real WhatsApp message to your business number
8. Check lead in dashboard

---

**Generated**: 2026-04-06  
**Webhook URL**: ✅ Correct  
**Verify Token**: ✅ Correct (`investo_webhook_verify_token`)  
**Production Status**: ⚠️ Needs Meta configuration  
**Localhost Status**: ✅ Ready to test
