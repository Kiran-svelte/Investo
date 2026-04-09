# Meta Webhook Production Proof

This runbook generates objective proof that the production webhook endpoint enforces Meta signature verification.

## Preconditions

- Production API is reachable.
- `WHATSAPP_APP_SECRET` in production matches Meta App Secret.
- Webhook endpoint is exposed as `https://<your-domain>/api/webhook`.

## Verification Command

Run this command from `backend`:

```bash
WEBHOOK_URL="https://<your-domain>/api/webhook" WHATSAPP_APP_SECRET="<meta-app-secret>" npm run proof:webhook
```

Windows PowerShell equivalent:

```powershell
$env:WEBHOOK_URL="https://<your-domain>/api/webhook"; $env:WHATSAPP_APP_SECRET="<meta-app-secret>"; npm run proof:webhook
```

## Expected Evidence

The command prints JSON lines for two cases:

1. `valid-signature` must return `200`
2. `invalid-signature` must return `403`

Final line must be:

```json
{"result":"PASS","passed":2,"total":2}
```

Store this output as deployment evidence (release artifact or CI log attachment).

## Failure Handling

- If valid signature returns non-200:
  - Check production route and middleware wiring.
  - Confirm inbound IP whitelist behavior for the source.
- If invalid signature returns non-403:
  - Check `WHATSAPP_APP_SECRET` is present in production config.
  - Check route uses raw body/signature check before processing.

## Audit Checkpoint

Run this verification:

- On every production deployment touching webhook code.
- After rotating Meta App Secret.
- At least weekly as part of operational controls.
