# WhatsApp production testing (Meta Cloud API)

## URLs

| Item | Value |
|------|--------|
| App | https://frontend-navy-eight-37.vercel.app |
| Webhook callback | `https://investo-backend-v2.onrender.com/api/webhook` |
| Health | https://investo-backend-v2.onrender.com/api/health |

## 1. In Investo UI (you did this)

**AI Settings → WhatsApp Business Integration**

1. **Save WhatsApp Configuration** — stores per-company credentials in `company.settings.whatsapp` (phone number ID, access token, etc.).
2. **Test Connection** — calls `POST /api/ai-settings/whatsapp/test`. On success the badge changes from **Saved — not verified** to **Connected**.

“Saved — not verified” only means credentials are stored; Meta is not confirmed until **Test Connection** succeeds.

## 2. In Meta Developer Console (required for inbound messages)

1. [Meta for Developers](https://developers.facebook.com/) → your app → **WhatsApp → Configuration**.
2. **Webhook**
   - **Callback URL:** `https://investo-backend-v2.onrender.com/api/webhook`
   - **Verify token:** must match Render env `WHATSAPP_VERIFY_TOKEN` (e.g. `abc-investo`), not only the UI field unless they are the same.
3. Click **Verify and save**, then subscribe to **messages** (and any fields you need).
4. **Phone number** must match the **Phone Number ID** saved in AI Settings.

## 3. Render env (global Meta fallback)

These apply to webhook verification and default sending if company settings are empty:

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN` (optional fallback)
- `WHATSAPP_PHONE_NUMBER_ID` (optional fallback)
- `WHATSAPP_APP_SECRET` (signature verification in production)

Per-company tokens in the UI override sending for that tenant when set.

## 4. End-to-end reply test

1. Log in as company admin (e.g. `admin@demorealty.in` / `demo@123`).
2. Complete **Test Connection** in AI Settings.
3. Confirm webhook is verified in Meta.
4. Enable **AI** for the company (AI Settings + feature flags).
5. From a **personal WhatsApp** (not the business app), message the **business display number** linked to your Phone Number ID.
6. Expect:
   - New or updated **lead** + **conversation** in the app.
   - **AI reply** on WhatsApp if `ai_enabled` and AI provider keys are set on Render (`OPENAI_API_KEY`, etc.).

## 5. Quick API checks (no WhatsApp needed)

**Webhook verify (Meta handshake):**

```bash
curl "https://investo-backend-v2.onrender.com/api/webhook?hub.mode=subscribe&hub.verify_token=abc-investo&hub.challenge=test123"
```

Expected: body `test123`.

**Test Connection (needs JWT):**

```bash
# Login first, then:
curl -X POST https://investo-backend-v2.onrender.com/api/ai-settings/whatsapp/test \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"meta","phone_number_id":"<ID>","access_token":"<TOKEN>"}'
```

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Saved — not verified | Run **Test Connection** after save |
| Meta webhook verify fails | `WHATSAPP_VERIFY_TOKEN` on Render vs Meta console |
| No inbound messages | Webhook URL, subscriptions, phone number ID match |
| Inbound but no AI reply | `OPENAI_API_KEY` / AI provider on Render; company AI settings |
| Wrong tenant | Unique `phoneNumberId` per company in settings |
