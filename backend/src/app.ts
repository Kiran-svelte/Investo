/** Production deploy marker — bump to force Railway rebuild when watch-path skip occurs. */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config';
import logger from './config/logger';
import { requestLogger } from './middleware/requestLogger';
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
import conversationRoutes from './routes/conversation.routes';
import aiSettingsRoutes from './routes/ai-settings.routes';
import conversionSettingsRoutes from './routes/conversion-settings.routes';
import webhookRoutes from './routes/webhook.routes';
import healthRoutes from './routes/health.routes';
import metricsRoutes from './routes/metrics.routes';
import readinessRoutes from './routes/readiness.routes';
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

const app = express();

// Render/other reverse proxies forward client IP via X-Forwarded-For.
// express-rate-limit requires trust proxy to be enabled to avoid ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// Security headers
app.use(helmet());

// Structured request logging + ops counters
app.use(requestLogger);

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

// Webhook routes (signature verified; light rate limit against abuse)
app.use('/api/webhook', webhookRateLimiter, whatsappAiRateLimiter, webhookRoutes);

// Body parsing (for all non-webhook routes)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeInput);

// Global rate limiting (per user: 100 req/min)
app.use('/api/', userRateLimiter);

// Auth routes with stricter rate limiting for login
app.use('/api/auth', sensitiveRateLimiter, authRoutes);

// All other routes with company-level rate limiting (1000 req/min per company)
app.use('/api/companies', companyRateLimiter, companyRoutes);
app.use('/api/users', companyRateLimiter, userRoutes);
app.use('/api/leads', companyRateLimiter, leadRoutes);
app.use('/api/property-projects', companyRateLimiter, propertyProjectRoutes);
app.use('/api/properties', companyRateLimiter, propertyRoutes);
// Public upload endpoint (no auth headers) must be mounted before the authenticated router.
app.use('/api/property-imports/uploads', propertyImportUploadRoutes);
// Bulk CSV/XLSX import must be mounted before the main router (prevents /:id wildcard capturing /bulk).
app.use('/api/property-imports/bulk', companyRateLimiter, propertyImportBulkRoutes);
app.use('/api/property-imports', companyRateLimiter, userAiRateLimiter, companyAiRateLimiter, propertyImportRoutes);
app.use('/api/visits', companyRateLimiter, visitRoutes);
app.use('/api/conversations', companyRateLimiter, conversationRoutes);
app.use('/api/ai-settings', companyRateLimiter, aiSettingsRoutes);
app.use('/api/conversion-settings', companyRateLimiter, conversionSettingsRoutes);
app.use('/api/analytics', companyRateLimiter, analyticsRoutes);
app.use('/api/notifications', companyRateLimiter, notificationRoutes);
app.use('/api/subscriptions', companyRateLimiter, subscriptionRoutes);
app.use('/api/admin', companyRateLimiter, adminRoutes);
app.use('/api/roles', companyRateLimiter, roleRoutes);
app.use('/api/features', companyRateLimiter, featureRoutes);
app.use('/api/onboarding', companyRateLimiter, onboardingRoutes);
app.use('/api/audit', companyRateLimiter, auditRoutes);
app.use('/api/agent-action-logs', companyRateLimiter, agentActionLogRoutes);
// authenticate runs first so the per-company AI rate limiters (which key on
// req.user.company_id) actually take effect; requireFeature gates on ai_bot.
app.use(
  '/api/copilot',
  authenticate,
  companyRateLimiter,
  userAiRateLimiter,
  companyAiRateLimiter,
  requireFeature('ai_bot'),
  copilotRoutes,
);
app.use('/api/error-logs', companyRateLimiter, errorLogRoutes);
app.use('/api/assignment-settings', companyRateLimiter, assignmentSettingsRoutes);
app.use('/api', financeRoutes);

// 404 handler
app.use((req, res) => {
  const requestId = (req as any).requestId as string | undefined;
  res.status(404).json({ error: 'Endpoint not found', requestId });
});

// Global error handler - does NOT leak internal details
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = (req as any).requestId as string | undefined;
  logger.error('Unhandled error', { message: err.message, stack: err.stack, requestId });
  res.status(500).json({ error: 'Internal server error', requestId });
});

export default app;
