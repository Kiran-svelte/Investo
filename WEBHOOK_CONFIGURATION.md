# WEBHOOK CONFIGURATION GUIDE

**Production Webhook URL**: `https://investo-backend-v2.onrender.com/api/webhook`  
**Localhost Webhook URL**: `http://localhost:3000/api/webhook`  
**Webhook Verify Token**: `investo_webhook_verify_token`

---

## FOR PRODUCTION (Meta Business Manager Setup)

### Step 1: Go to Meta Business Suite
https://business.facebook.com/

### Step 2: Create WhatsApp Business App
1. Navigate to **WhatsApp** > **API Setup**
2. Create a new app or select existing app
3. Get your **Phone Number ID** and **Access Token**

### Step 3: Configure Webhook in Meta
1. Go to **Configuration** > **Webhook**
2. Click **"Edit"**
3. Enter these values:

```
Callback URL: https://investo-backend-v2.onrender.com/api/webhook
Verify Token: investo_webhook_verify_token
```

4. Click **"Verify and Save"**

Meta will send a GET request to verify:
```
GET https://investo-backend-v2.onrender.com/api/webhook?hub.mode=subscribe&hub.verify_token=investo_webhook_verify_token&hub.challenge=RANDOM_STRING
```

Your backend will respond with the challenge value.

### Step 4: Subscribe to Webhook Events
Select these webhook fields:
- ✅ messages
- ✅ message_status (optional)

### Step 5: Set Environment Variables in Render

Go to Render Dashboard → `investo-backend-v2` → Environment:

```bash
WHATSAPP_VERIFY_TOKEN=investo_webhook_verify_token
WHATSAPP_ACCESS_TOKEN=<YOUR_META_ACCESS_TOKEN>
WHATSAPP_PHONE_NUMBER_ID=<YOUR_PHONE_NUMBER_ID>
WHATSAPP_APP_SECRET=<YOUR_APP_SECRET>  # Required in production (signature verification)
WHATSAPP_IP_WHITELIST_ENABLED=true     # Recommended in production
```

### Step 6: Redeploy Backend
After adding env vars, trigger a redeploy in Render.

---

## FOR LOCALHOST TESTING

### Option 1: Use Test Endpoint (Dev Mode)

No Meta setup needed! Use the built-in test endpoint:

```bash
POST http://localhost:3000/api/webhook/test
Authorization: Bearer <YOUR_JWT_TOKEN>
Content-Type: application/json

{
  "phone": "+919876543210",
  "name": "Test Customer",
  "message": "I want to buy a property in Bangalore"
}
```

This bypasses IP whitelist and simulates a WhatsApp message.

### Option 2: Use ngrok for Real Webhook
If you want Meta to send real webhooks to localhost:

```bash
# Install ngrok
ngrok http 3000

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
# Use in Meta webhook config:
Callback URL: https://abc123.ngrok.io/api/webhook
Verify Token: investo_webhook_verify_token
```

---

## ENVIRONMENT VARIABLES NEEDED

### Backend (.env file)
```bash
# Required for WhatsApp Integration
WHATSAPP_VERIFY_TOKEN=investo_webhook_verify_token
WHATSAPP_ACCESS_TOKEN=<from Meta>
WHATSAPP_PHONE_NUMBER_ID=<from Meta>

# Required for production webhook security
WHATSAPP_APP_SECRET=<from Meta>  # Required in production for webhook signature verification

# Optional hardening
WHATSAPP_IP_WHITELIST_ENABLED=true  # Recommended in production - allows only Meta IP ranges
SKIP_IP_WHITELIST=true  # Development ONLY - disables Meta IP check
```

### Frontend (.env or Render/Vercel)
No WhatsApp env vars needed in frontend.

---

## SECURITY NOTES

### IP Whitelist Protection
When enabled (`WHATSAPP_IP_WHITELIST_ENABLED=true`), the webhook endpoint has IP whitelist middleware that only allows:
- **Meta/Facebook IP ranges** (173.252.96.0/19, 66.220.144.0/20, etc.)
- **Development mode** with `SKIP_IP_WHITELIST=true`

This prevents spoofing attacks where malicious actors try to fake WhatsApp webhooks.

### Signature Verification
For production, set `WHATSAPP_APP_SECRET` to enable webhook signature verification:
```typescript
// Backend validates:
X-Hub-Signature-256: sha256=<HMAC>
```

---

## TESTING CHECKLIST

### Production:
- [ ] Meta Business Manager account created
- [ ] WhatsApp Business API app created
- [ ] Phone Number ID obtained
- [ ] Access Token obtained
- [ ] Webhook URL verified in Meta: `https://investo-backend-v2.onrender.com/api/webhook`
- [ ] Webhook verify token set: `investo_webhook_verify_token`
- [ ] Environment variables set in Render
- [ ] Backend redeployed
- [ ] Send test message from WhatsApp
- [ ] Check lead created in dashboard

### Localhost:
- [ ] Backend running on port 3000
- [ ] Login to get JWT token
- [ ] Test POST /api/webhook/test endpoint
- [ ] Verify lead created
- [ ] Verify conversation created
- [ ] Check AI response generated (if OPENAI_API_KEY set)

---

## CURRENT STATUS

### Production:
- ✅ Webhook URL: Correct (`https://investo-backend-v2.onrender.com/api/webhook`)
- ✅ Verify Token: Set (`investo_webhook_verify_token`)
- ❌ Access Token: **NOT SET** (need from Meta)
- ❌ Phone Number ID: **NOT SET** (need from Meta)
- ⚠️ Status: **Not Configured** - Meta account setup required

### Localhost:
- ✅ Webhook URL: `http://localhost:3000/api/webhook`
- ✅ Verify Token: `investo_webhook_verify_token`
- ✅ Test Endpoint: `/api/webhook/test` available
- ✅ IP Whitelist: Bypassed in dev mode
- ✅ Status: **Ready for Testing** (use test endpoint)

---

## SHOWN IN FRONTEND (AI Settings Page)

Based on the screenshot you provided, the frontend displays:

```
Phone Number ID: 109052801080770
Access Token: ••••••••••••••••••••••••••••••••••••
Webhook Verify Token: [Your custom verification token]
Webhook URL (Read-only): https://investo-backend-v2.onrender.com/api/webhook
```

### What to Enter:

1. **Phone Number ID**: Get from Meta → **WhatsApp** → **API Setup** → **Phone Numbers**
2. **Access Token**: Get from Meta → **WhatsApp** → **API Setup** → **Temporary access token** (or generate permanent token)
3. **Webhook Verify Token**: Use `investo_webhook_verify_token` (already configured)
4. **Webhook URL**: Already set correctly (read-only field)

### Then click:
1. **"ai_settings.test_connection"** button → Tests if WhatsApp API is reachable
2. **"Save WhatsApp Configuration"** button → Saves to database

---

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
