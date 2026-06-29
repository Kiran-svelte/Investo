/** Production deploy marker — bump to force Railway rebuild when watch-path skip occurs. (2026-06-14 multi-project enterprise chunks 01–10) */
import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import { securityHeadersMiddleware } from './middleware/securityHeaders';
import cookieParser from 'cookie-parser';
import config from './config';
import logger from './config/logger';
import { requestLogger } from './middleware/requestLogger';
import { metricsMiddleware } from './middleware/metricsMiddleware';
import { sanitizeInput } from './middleware/sanitizeInput';
import {
  userRateLimiter,
  companyRateLimiter,
  companyAiRateLimiter,
  userAiRateLimiter,
  sensitiveRateLimiter,
  webhookRateLimiter,
  whatsappAiRateLimiter,
} from './middleware/rateLimiter';
import authRoutes from './routes/auth.routes';
import companyRoutes from './routes/company.routes';
import userRoutes from './routes/user.routes';
import leadRoutes from './routes/lead.routes';
import propertyRoutes from './routes/property.routes';
import propertyProjectRoutes from './routes/property-project.routes';
import visitRoutes from './routes/visit.routes';
import calendarRoutes from './routes/calendar.routes';
import conversationRoutes from './routes/conversation.routes';
import aiSettingsRoutes from './routes/ai-settings.routes';
import conversionSettingsRoutes from './routes/conversion-settings.routes';
import webhookRoutes from './routes/webhook.routes';
import healthRoutes from './routes/health.routes';
import metricsRoutes from './routes/metrics.routes';
import readinessRoutes from './routes/readiness.routes';
import platformRoutes from './routes/platform.routes';
import deadLetterRoutes from './routes/dead-letter.routes';
import quotaRoutes from './routes/quota.routes';
import adminQuotaRoutes from './routes/admin-quota.routes';
import statusRoutes from './routes/status.routes';
import identitySettingsRoutes from './routes/identity-settings.routes';
import ssoRoutes from './identity/sso/sso.routes';
import mfaRoutes from './identity/mfa/mfa.routes';
import scimRoutes from './identity/scim/scim.routes';
import branchRoutes from './identity/org/branch.routes';
import securityRoutes from './routes/security.routes';
import complianceRoutes from './compliance/compliance.routes';
import governanceRoutes from './governance/governance.routes';
import publicApiRoutes from './publicApi/publicApi.routes';
import billingOpsRoutes from './billingOps/billingOps.routes';
import supportOpsRoutes from './supportOps/supportOps.routes';
import dataPlatformRoutes from './dataPlatform/dataPlatform.routes';
import enterpriseConfigRoutes from './enterpriseConfig/enterpriseConfig.routes';
import { readOnlyMiddleware } from './dr/readOnly.middleware';
import analyticsRoutes from './routes/analytics.routes';
import notificationRoutes from './routes/notification.routes';
import subscriptionRoutes from './routes/subscription.routes';
import adminRoutes from './routes/admin.routes';
import roleRoutes from './routes/role.routes';
import featureRoutes from './routes/feature.routes';
import onboardingRoutes from './routes/onboarding.routes';
import auditRoutes from './routes/audit.routes';
import errorLogRoutes from './routes/error-log.routes';
import assignmentSettingsRoutes from './routes/assignment-settings.routes';
import agentActionLogRoutes from './routes/agent-action-log.routes';
import propertyImportRoutes from './routes/property-import.routes';
import propertyImportUploadRoutes from './routes/property-import-upload.routes';
import propertyImportBulkRoutes from './routes/property-import-bulk.routes';
import financeRoutes from './routes/finance.routes';
import { isAllowedCorsOrigin } from './config';
import copilotRoutes from './routes/copilot.routes';
import { authenticate } from './middleware/auth';
import { requireFeature } from './middleware/featureGate';
import billingAdminRoutes from './routes/billing-admin.routes';
import agencyInviteRoutes from './routes/agencyInvite.routes';
import cashfreeWebhookRoutes from './routes/cashfreeWebhook.routes';
import resendWebhookRoutes from './routes/resendWebhook.routes';
import {
  isSubscriptionRecoveryPath,
  requireActivePaidSubscription,
} from './middleware/subscriptionEnforcement';

const app = express();

// Render/other reverse proxies forward client IP via X-Forwarded-For.
// express-rate-limit requires trust proxy to be enabled to avoid ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// Security headers
app.use(securityHeadersMiddleware);

// Structured request logging + ops counters
app.use(requestLogger);
app.use(metricsMiddleware);

// CORS
app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedCorsOrigin(origin)) {
        callback(null, origin || true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin || 'unknown'}`));
    },
    credentials: true,
  })
);

// Health check (no auth required)
app.use('/api/health', healthRoutes);
app.use('/api/readiness', readinessRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/status', statusRoutes);

// Webhook routes (signature verified; light rate limit against abuse)
app.use('/api/webhook', webhookRateLimiter, whatsappAiRateLimiter, webhookRoutes);
// Cashfree payment webhook — separate from WhatsApp webhook, no IP restriction needed
app.use('/api/webhooks/cashfree', webhookRateLimiter, cashfreeWebhookRoutes);
// Resend delivery events require raw body signature verification before express.json().
app.use('/api/webhooks/resend', webhookRateLimiter, resendWebhookRoutes);

// Body parsing (for all non-webhook routes)
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeInput);

// DR read-only mode — blocks mutating requests when FEATURE_READ_ONLY_MODE=true
app.use(readOnlyMiddleware);

// Global rate limiting (per user: 100 req/min)
app.use('/api/', userRateLimiter);

// Identity auth routes require parsed request bodies; keep them after express.json().
app.use('/api/auth/sso', sensitiveRateLimiter, ssoRoutes);
app.use('/api/auth/mfa', sensitiveRateLimiter, mfaRoutes);
app.use('/scim/v2', scimRoutes);

// Auth routes with stricter rate limiting for login
app.use('/api/auth', sensitiveRateLimiter, authRoutes);

// INVESTO-20260629-PAYMENT-LOCKOUT:
// Expired billing tenants can reach billing/auth/recovery APIs only.
// Normal tenant product APIs remain locked until subscription access is restored.
app.use('/api', (req, res, next) => {
  if (isSubscriptionRecoveryPath(req.path)) {
    next();
    return;
  }

  authenticate(req, res, () => {
    void requireActivePaidSubscription(req, res, next);
  });
});

// All protected routes: authenticate FIRST so company_id is available for
// per-company rate limiters (companyRateLimiter keys on req.user.company_id).
// Without this order, company_id is undefined and the limits never apply.
app.use('/api/companies', authenticate, companyRateLimiter, companyRoutes);
app.use('/api/users', authenticate, companyRateLimiter, userRoutes);
app.use('/api/leads', authenticate, companyRateLimiter, leadRoutes);
app.use('/api/property-projects', authenticate, companyRateLimiter, propertyProjectRoutes);
app.use('/api/properties', authenticate, companyRateLimiter, propertyRoutes);
// Public upload endpoint (no auth headers) must be mounted before the authenticated router.
app.use('/api/property-imports/uploads', propertyImportUploadRoutes);
// Bulk CSV/XLSX import must be mounted before the main router (prevents /:id wildcard capturing /bulk).
app.use('/api/property-imports/bulk', authenticate, companyRateLimiter, propertyImportBulkRoutes);
app.use('/api/property-imports', authenticate, companyRateLimiter, userAiRateLimiter, companyAiRateLimiter, propertyImportRoutes);
app.use('/api/visits', authenticate, companyRateLimiter, visitRoutes);
app.use('/api/calendar', authenticate, companyRateLimiter, calendarRoutes);
app.use('/api/conversations', authenticate, companyRateLimiter, conversationRoutes);
app.use('/api/ai-settings', authenticate, companyRateLimiter, aiSettingsRoutes);
app.use('/api/conversion-settings', authenticate, companyRateLimiter, conversionSettingsRoutes);
app.use('/api/analytics', authenticate, companyRateLimiter, analyticsRoutes);
app.use('/api/notifications', authenticate, companyRateLimiter, notificationRoutes);
app.use('/api/subscriptions', authenticate, companyRateLimiter, subscriptionRoutes);
app.use('/api/admin', authenticate, companyRateLimiter, adminRoutes);
app.use('/api/platform', authenticate, companyRateLimiter, platformRoutes);
app.use('/api/security', authenticate, companyRateLimiter, securityRoutes);
app.use('/api/compliance', authenticate, companyRateLimiter, complianceRoutes);
app.use('/api/governance', authenticate, companyRateLimiter, governanceRoutes);
app.use('/api/v1', publicApiRoutes);
app.use('/api/billing-ops', authenticate, companyRateLimiter, billingOpsRoutes);
app.use('/api/support-ops', authenticate, companyRateLimiter, supportOpsRoutes);
app.use('/api/data-platform', authenticate, companyRateLimiter, dataPlatformRoutes);
app.use('/api/enterprise-config', authenticate, companyRateLimiter, enterpriseConfigRoutes);
app.use('/api/dead-letter', authenticate, companyRateLimiter, deadLetterRoutes);
app.use('/api/quota', authenticate, companyRateLimiter, quotaRoutes);
app.use('/api/admin/quota', authenticate, companyRateLimiter, adminQuotaRoutes);
app.use('/api/settings', authenticate, companyRateLimiter, identitySettingsRoutes);
app.use('/api/branches', authenticate, companyRateLimiter, branchRoutes);
app.use('/api/roles', authenticate, companyRateLimiter, roleRoutes);
app.use('/api/features', authenticate, companyRateLimiter, featureRoutes);
app.use('/api/onboarding', authenticate, companyRateLimiter, onboardingRoutes);
app.use('/api/audit', authenticate, companyRateLimiter, auditRoutes);
app.use('/api/agent-action-logs', authenticate, companyRateLimiter, agentActionLogRoutes);
app.use(
  '/api/copilot',
  authenticate,
  companyRateLimiter,
  userAiRateLimiter,
  companyAiRateLimiter,
  requireFeature('ai_bot'),
  copilotRoutes,
);
app.use('/api/error-logs', authenticate, companyRateLimiter, errorLogRoutes);
app.use('/api/assignment-settings', authenticate, companyRateLimiter, assignmentSettingsRoutes);
app.use('/api', financeRoutes);
app.use('/api/billing-admin', authenticate, billingAdminRoutes);
app.use('/api/agency-invites', agencyInviteRoutes);

// 404 handler
app.use((req, res) => {
  const requestId = (req as any).requestId as string | undefined;
  res.status(404).json({ error: 'Endpoint not found', requestId });
});

// Sentry error handler — must be BEFORE the generic error handler and AFTER all routes.
// Only active when SENTRY_DSN is configured.
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

// Global error handler - does NOT leak internal details
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = (req as any).requestId as string | undefined;
  logger.error('Unhandled error', { message: err.message, stack: err.stack, requestId });
  // Capture in Sentry if not already handled by the Sentry error handler middleware
  if (!process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  res.status(500).json({ error: 'Internal server error', requestId });
});

export default app;
