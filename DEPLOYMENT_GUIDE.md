# Investo Deployment Guide

## Current Status (2026-04-06)

### Issues Fixed:
1. ✅ **Login Issue** - Fixed incorrect NEON_AUTH_URL in backend/.env
   - Was: `https://ep-silent-cell-amwzz7s3.apirest.c-5.us-east-1.aws.neon.tech/neondb/rest/v1` (Data API)
   - Now: `https://ep-silent-cell-amwzz7s3.neonauth.c-5.us-east-1.aws.neon.tech/neondb/auth` (Auth endpoint)

2. ✅ **Backend Build** - Backend compiles successfully
3. ✅ **Local Testing** - Login works locally (tested with admin@investo.in / admin@123)
4. ✅ **WhatsApp Webhook** - Webhook verification endpoint works

### Deployment Services:

#### Render (Backend)
- **Service**: investo-backend-v2 (srv-d79itik50q8c73fjqi7g)
- **URL**: https://investo-backend-v2.onrender.com
- **Status**: Deployment triggered via API

#### Vercel (Frontend)
- **Project**: frontend
- **URL**: https://frontend-navy-eight-37.vercel.app
- **Current API**: VITE_API_URL needs to be updated

---

## Critical Environment Variables to Update in Render Dashboard

Navigate to: https://dashboard.render.com/web/srv-d79itik50q8c73fjqi7g

### Required Updates:

```bash
# Database - Use values from backend/.env file  
DATABASE_URL=<your-neon-database-url-with-pooler>

# CRITICAL FIX: Neon Auth URL (NOT the Data API URL)
NEON_AUTH_URL=https://ep-silent-cell-amwzz7s3.neonauth.c-5.us-east-1.aws.neon.tech/neondb/auth

# Redis - Use values from backend/.env file
UPSTASH_REDIS_REST_URL=<your-upstash-redis-url>
UPSTASH_REDIS_REST_TOKEN=<your-upstash-redis-token>

# JWT - Use values from backend/.env file
JWT_SECRET=<your-jwt-secret-from-backend-env>
JWT_REFRESH_SECRET=<your-jwt-refresh-secret-from-backend-env>
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# WhatsApp
WHATSAPP_VERIFY_TOKEN=investo_webhook_verify_token
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
SKIP_IP_WHITELIST=true

# AI
AI_PROVIDER=openai
OPENAI_API_KEY=<your-openai-api-key-from-backend-env>
OPENAI_MODEL=gpt-4o

# App Config
NODE_ENV=production
CORS_ORIGINS=https://frontend-navy-eight-37.vercel.app,https://investo-frontend-v2.onrender.com
FRONTEND_BASE_URL=https://frontend-navy-eight-37.vercel.app
DB_AUTO_MIGRATE=true
DB_AUTO_SEED=true
```

---

## Vercel Environment Variables

Update in Vercel Dashboard: https://vercel.com/traderlig hterer11-7085s-projects/frontend/settings/environment-variables

```bash
# Backend API URL - Point to Render backend
VITE_API_URL=https://investo-backend-v2.onrender.com/api

# Neon Auth URL
VITE_NEON_AUTH_URL=https://ep-silent-cell-amwzz7s3.neonauth.c-5.us-east-1.aws.neon.tech/neondb/auth
```

After updating, trigger a new deployment in Vercel.

---

## Manual Steps Required:

### 1. Update Render Environment Variables
- Go to Render Dashboard → investo-backend-v2 → Environment
- Add/update all variables listed above
- Save and trigger redeploy

### 2. Update Vercel Environment Variables
- Go to Vercel Dashboard → frontend → Settings → Environment Variables
- Update `VITE_API_URL` to point to Render backend
- Update `VITE_NEON_AUTH_URL` to the correct Auth endpoint
- Trigger redeploy

### 3. Test Deployment
After both deployments complete:

```bash
# Test backend health
curl https://investo-backend-v2.onrender.com/api/health

# Test login
curl -X POST https://investo-backend-v2.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@investo.in","password":"admin@123"}'

# Test WhatsApp webhook verification
curl "https://investo-backend-v2.onrender.com/api/webhook?hub.mode=subscribe&hub.verify_token=investo_webhook_verify_token&hub.challenge=test123"
```

### 4. Access Frontend
- Navigate to: https://frontend-navy-eight-37.vercel.app
- Try logging in with: admin@investo.in / admin@123

---

## Test Credentials

### Super Admin
- Email: `admin@investo.in`
- Password: `admin@123`

### Demo Company Admin
- Email: `admin@demorealty.in`
- Password: `demo@123`

---

## Troubleshooting

### If login still fails:
1. Check Render logs: `https://dashboard.render.com/web/srv-d79itik50q8c73fjqi7g/logs`
2. Verify NEON_AUTH_URL is the Auth endpoint (not Data API)
3. Check CORS_ORIGINS includes your Vercel URL
4. Verify DATABASE_URL is correct

### If WhatsApp webhook fails:
1. Ensure WHATSAPP_VERIFY_TOKEN is set correctly
2. Check SKIP_IP_WHITELIST=true for testing
3. Verify Meta webhook is pointing to: `https://investo-backend-v2.onrender.com/api/webhook`

---

## Next Steps

1. ✅ Fix NEON_AUTH_URL - DONE
2. ⏳ Update Render environment variables - IN PROGRESS (deployment triggered)
3. ⏳ Update Vercel environment variables - PENDING
4. ⏳ Verify deployments work - PENDING
5. ⏳ Test full login flow - PENDING
6. ⏳ Test WhatsApp integration - PENDING

---

## Render API Key Used
`rnd_M9OmIvcNYUUcEcdBRRr1lEdZNoXj`

Deployment ID: `dep-d79ovhggjchc73fom0d0`
Status: Build in progress
