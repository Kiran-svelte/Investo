# Auth session cookies (Google/AWS-style)

## What changed

Investo now issues **HttpOnly session cookies** on login, signup, and token refresh — the same pattern used by Google Cloud Console, AWS Console, and most enterprise SaaS apps.

| Cookie | Purpose | Flags |
|--------|---------|-------|
| `investo_access_token` | Short-lived API access (JWT) | `HttpOnly`, `Secure` (prod), `SameSite=None` (prod cross-site), path `/api` |
| `investo_refresh_token` | Long-lived refresh + rotation | Same flags, path `/api/auth` (narrow scope) |

## Why not localStorage?

| Approach | XSS risk | CSRF risk | Industry use |
|----------|----------|-----------|--------------|
| **localStorage JWT** | High — any script can read tokens | Lower | Legacy SPAs |
| **HttpOnly cookies** | Low — JavaScript cannot read | Mitigated with `SameSite` + CORS `credentials` | Google, AWS, banks |

**HttpOnly** = browser sends cookie automatically; JavaScript cannot `document.cookie` it.  
**Secure** = HTTPS only in production.  
**SameSite=None; Secure** = required when frontend (`biginvesto.online`) and API (Railway) are different sites.  
**Path-scoped refresh cookie** = refresh token only sent to `/api/auth/*`, not every API call.

## Client behaviour

- Axios uses `withCredentials: true` so cookies flow on cross-origin requests.
- When `session.storage === 'httpOnly_cookie'`, tokens are **not** stored in `localStorage`.
- Legacy Bearer tokens in `localStorage` still work during migration.
- Socket.IO uses `withCredentials: true` and reads the access cookie on handshake.

## Onboarding redirect fix

After first-time password change, `company_admin` users now route to `/onboarding` when steps are incomplete (not `/dashboard`). Profile phone collection no longer blocks the onboarding route.

## Verify production

```bash
curl -s https://investo-backend-production.up.railway.app/api/health/live
# deploy_note should include session-cookies build

# Login sets Set-Cookie headers (browser devtools → Network → login → Response Headers)
```

## Optional env

- `AUTH_COOKIE_DOMAIN` — set if cookies must span subdomains (e.g. `.biginvesto.online`)
