import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config';
import logger from './config/logger';
import { userRateLimiter, companyRateLimiter, sensitiveRateLimiter } from './middleware/rateLimiter';
import authRoutes from './routes/auth.routes';
import companyRoutes from './routes/company.routes';
import userRoutes from './routes/user.routes';
import leadRoutes from './routes/lead.routes';
import propertyRoutes from './routes/property.routes';
import visitRoutes from './routes/visit.routes';
import conversationRoutes from './routes/conversation.routes';
import aiSettingsRoutes from './routes/ai-settings.routes';
import webhookRoutes from './routes/webhook.routes';
import healthRoutes from './routes/health.routes';
import analyticsRoutes from './routes/analytics.routes';
import notificationRoutes from './routes/notification.routes';
import subscriptionRoutes from './routes/subscription.routes';
import adminRoutes from './routes/admin.routes';
import roleRoutes from './routes/role.routes';
import featureRoutes from './routes/feature.routes';
import onboardingRoutes from './routes/onboarding.routes';
import auditRoutes from './routes/audit.routes';
import propertyImportRoutes from './routes/property-import.routes';
import financeRoutes from './routes/finance.routes';
import { isAllowedCorsOrigin } from './config';

const app = express();

// Security headers
app.use(helmet());

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

// Webhook routes (no rate limiting - verified by signature)
// IMPORTANT: This must run before global JSON parsing so we can verify signatures against raw request bytes.
app.use('/api/webhook', webhookRoutes);

// Body parsing (for all non-webhook routes)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Global rate limiting (per user: 100 req/min)
app.use('/api/', userRateLimiter);

// Auth routes with stricter rate limiting for login
app.use('/api/auth', sensitiveRateLimiter, authRoutes);

// All other routes with company-level rate limiting (1000 req/min per company)
app.use('/api/companies', companyRateLimiter, companyRoutes);
app.use('/api/users', companyRateLimiter, userRoutes);
app.use('/api/leads', companyRateLimiter, leadRoutes);
app.use('/api/properties', companyRateLimiter, propertyRoutes);
app.use('/api/property-imports', companyRateLimiter, propertyImportRoutes);
app.use('/api/visits', companyRateLimiter, visitRoutes);
app.use('/api/conversations', companyRateLimiter, conversationRoutes);
app.use('/api/ai-settings', companyRateLimiter, aiSettingsRoutes);
app.use('/api/analytics', companyRateLimiter, analyticsRoutes);
app.use('/api/notifications', companyRateLimiter, notificationRoutes);
app.use('/api/subscriptions', companyRateLimiter, subscriptionRoutes);
app.use('/api/admin', companyRateLimiter, adminRoutes);
app.use('/api/roles', companyRateLimiter, roleRoutes);
app.use('/api/features', companyRateLimiter, featureRoutes);
app.use('/api/onboarding', companyRateLimiter, onboardingRoutes);
app.use('/api/audit', companyRateLimiter, auditRoutes);
app.use('/api', financeRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler - does NOT leak internal details
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
