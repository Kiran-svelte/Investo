# Investo API (Backend)

Node.js / Express / Prisma backend for Investo CRM, WhatsApp AI copilot, and property workflows.

## Local setup

```bash
cd backend
npm install
cp .env.example .env   # fill DATABASE_URL, OPENAI_API_KEY, etc.
npx prisma generate
npm run dev
```

API listens on `PORT` (default `3001`). Health: `GET /api/health`, liveness `GET /api/health/live`, readiness `GET /api/health/ready`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Prisma generate + `tsc` |
| `npm start` | Run compiled `dist/server.js` |
| `npm test` | Jest unit tests |

## Key environment variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `OPENAI_API_KEY` | LLM + embeddings |
| `RATE_LIMIT_USER` | Per-user API cap / minute (default 100) |
| `RATE_LIMIT_COMPANY` | Per-company cap / minute (default 1000) |
| `RATE_LIMIT_WHATSAPP_AI` | WhatsApp AI messages per sender / minute (default 60) |
| `REDIS_URL` / `REDIS_TOKEN` | Upstash Redis (optional; in-memory fallback) |

See `src/config/index.ts` for the full list.

## Deployment

Production runs on [Render](https://render.com) (`investo-backend-v2`). Push to `main` triggers auto-deploy, or run `scripts/redeploy-production.ps1` with `RENDER_API_KEY`.

## Docs

- `docs/runbook.md` — incident playbooks
- `../docs/PRODUCTION_POLISH.md` — production pillars checklist
- `../docs/ARCHITECTURE.md` — system overview
