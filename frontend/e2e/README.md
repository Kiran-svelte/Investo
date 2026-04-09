# Browser Regression Pack (Playwright)

## Purpose

Covers high-risk user journeys at browser level:

- Authentication path (`/login`)
- Core CRM routes (`/leads`, `/properties`, `/properties/import`)
- Regression checks for fatal UI failures and unexpected auth redirects

## Prerequisites

Set credentials for an existing test user:

```powershell
$env:E2E_EMAIL="admin@investo.in"
$env:E2E_PASSWORD="<password>"
```

Optional:

```powershell
$env:E2E_PORT="4173"
$env:E2E_BASE_URL="http://127.0.0.1:4173"

# Public (no-login) smoke flows
$env:E2E_FORGOT_PASSWORD_EMAIL="someone@example.com"
```

## Run

```bash
npm run test:e2e
```

Headed mode:

```bash
npm run test:e2e:headed
```

## CI Notes

- The Playwright config starts the Vite app automatically.
- Traces, screenshots, and videos are retained on failure for triage.
