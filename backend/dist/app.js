"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/** Production deploy marker — bump to force Railway rebuild when watch-path skip occurs. (2026-06-07b call/visit + location) */
const Sentry = __importStar(require("@sentry/node"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const logger_1 = __importDefault(require("./config/logger"));
const requestLogger_1 = require("./middleware/requestLogger");
const sanitizeInput_1 = require("./middleware/sanitizeInput");
const rateLimiter_1 = require("./middleware/rateLimiter");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const company_routes_1 = __importDefault(require("./routes/company.routes"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const lead_routes_1 = __importDefault(require("./routes/lead.routes"));
const property_routes_1 = __importDefault(require("./routes/property.routes"));
const property_project_routes_1 = __importDefault(require("./routes/property-project.routes"));
const visit_routes_1 = __importDefault(require("./routes/visit.routes"));
const conversation_routes_1 = __importDefault(require("./routes/conversation.routes"));
const ai_settings_routes_1 = __importDefault(require("./routes/ai-settings.routes"));
const conversion_settings_routes_1 = __importDefault(require("./routes/conversion-settings.routes"));
const webhook_routes_1 = __importDefault(require("./routes/webhook.routes"));
const health_routes_1 = __importDefault(require("./routes/health.routes"));
const metrics_routes_1 = __importDefault(require("./routes/metrics.routes"));
const readiness_routes_1 = __importDefault(require("./routes/readiness.routes"));
const analytics_routes_1 = __importDefault(require("./routes/analytics.routes"));
const notification_routes_1 = __importDefault(require("./routes/notification.routes"));
const subscription_routes_1 = __importDefault(require("./routes/subscription.routes"));
const admin_routes_1 = __importDefault(require("./routes/admin.routes"));
const role_routes_1 = __importDefault(require("./routes/role.routes"));
const feature_routes_1 = __importDefault(require("./routes/feature.routes"));
const onboarding_routes_1 = __importDefault(require("./routes/onboarding.routes"));
const audit_routes_1 = __importDefault(require("./routes/audit.routes"));
const error_log_routes_1 = __importDefault(require("./routes/error-log.routes"));
const assignment_settings_routes_1 = __importDefault(require("./routes/assignment-settings.routes"));
const agent_action_log_routes_1 = __importDefault(require("./routes/agent-action-log.routes"));
const property_import_routes_1 = __importDefault(require("./routes/property-import.routes"));
const property_import_upload_routes_1 = __importDefault(require("./routes/property-import-upload.routes"));
const property_import_bulk_routes_1 = __importDefault(require("./routes/property-import-bulk.routes"));
const finance_routes_1 = __importDefault(require("./routes/finance.routes"));
const config_1 = require("./config");
const copilot_routes_1 = __importDefault(require("./routes/copilot.routes"));
const auth_1 = require("./middleware/auth");
const featureGate_1 = require("./middleware/featureGate");
const app = (0, express_1.default)();
// Render/other reverse proxies forward client IP via X-Forwarded-For.
// express-rate-limit requires trust proxy to be enabled to avoid ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);
// Security headers
app.use((0, helmet_1.default)());
// Structured request logging + ops counters
app.use(requestLogger_1.requestLogger);
// CORS
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if ((0, config_1.isAllowedCorsOrigin)(origin)) {
            callback(null, origin || true);
            return;
        }
        callback(new Error(`CORS blocked for origin: ${origin || 'unknown'}`));
    },
    credentials: true,
}));
// Health check (no auth required)
app.use('/api/health', health_routes_1.default);
app.use('/api/readiness', readiness_routes_1.default);
app.use('/api/metrics', metrics_routes_1.default);
// Webhook routes (signature verified; light rate limit against abuse)
app.use('/api/webhook', rateLimiter_1.webhookRateLimiter, rateLimiter_1.whatsappAiRateLimiter, webhook_routes_1.default);
// Body parsing (for all non-webhook routes)
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use(sanitizeInput_1.sanitizeInput);
// Global rate limiting (per user: 100 req/min)
app.use('/api/', rateLimiter_1.userRateLimiter);
// Auth routes with stricter rate limiting for login
app.use('/api/auth', rateLimiter_1.sensitiveRateLimiter, auth_routes_1.default);
// All protected routes: authenticate FIRST so company_id is available for
// per-company rate limiters (companyRateLimiter keys on req.user.company_id).
// Without this order, company_id is undefined and the limits never apply.
app.use('/api/companies', auth_1.authenticate, rateLimiter_1.companyRateLimiter, company_routes_1.default);
app.use('/api/users', auth_1.authenticate, rateLimiter_1.companyRateLimiter, user_routes_1.default);
app.use('/api/leads', auth_1.authenticate, rateLimiter_1.companyRateLimiter, lead_routes_1.default);
app.use('/api/property-projects', auth_1.authenticate, rateLimiter_1.companyRateLimiter, property_project_routes_1.default);
app.use('/api/properties', auth_1.authenticate, rateLimiter_1.companyRateLimiter, property_routes_1.default);
// Public upload endpoint (no auth headers) must be mounted before the authenticated router.
app.use('/api/property-imports/uploads', property_import_upload_routes_1.default);
// Bulk CSV/XLSX import must be mounted before the main router (prevents /:id wildcard capturing /bulk).
app.use('/api/property-imports/bulk', auth_1.authenticate, rateLimiter_1.companyRateLimiter, property_import_bulk_routes_1.default);
app.use('/api/property-imports', auth_1.authenticate, rateLimiter_1.companyRateLimiter, rateLimiter_1.userAiRateLimiter, rateLimiter_1.companyAiRateLimiter, property_import_routes_1.default);
app.use('/api/visits', auth_1.authenticate, rateLimiter_1.companyRateLimiter, visit_routes_1.default);
app.use('/api/conversations', auth_1.authenticate, rateLimiter_1.companyRateLimiter, conversation_routes_1.default);
app.use('/api/ai-settings', auth_1.authenticate, rateLimiter_1.companyRateLimiter, ai_settings_routes_1.default);
app.use('/api/conversion-settings', auth_1.authenticate, rateLimiter_1.companyRateLimiter, conversion_settings_routes_1.default);
app.use('/api/analytics', auth_1.authenticate, rateLimiter_1.companyRateLimiter, analytics_routes_1.default);
app.use('/api/notifications', auth_1.authenticate, rateLimiter_1.companyRateLimiter, notification_routes_1.default);
app.use('/api/subscriptions', auth_1.authenticate, rateLimiter_1.companyRateLimiter, subscription_routes_1.default);
app.use('/api/admin', auth_1.authenticate, rateLimiter_1.companyRateLimiter, admin_routes_1.default);
app.use('/api/roles', auth_1.authenticate, rateLimiter_1.companyRateLimiter, role_routes_1.default);
app.use('/api/features', auth_1.authenticate, rateLimiter_1.companyRateLimiter, feature_routes_1.default);
app.use('/api/onboarding', auth_1.authenticate, rateLimiter_1.companyRateLimiter, onboarding_routes_1.default);
app.use('/api/audit', auth_1.authenticate, rateLimiter_1.companyRateLimiter, audit_routes_1.default);
app.use('/api/agent-action-logs', auth_1.authenticate, rateLimiter_1.companyRateLimiter, agent_action_log_routes_1.default);
app.use('/api/copilot', auth_1.authenticate, rateLimiter_1.companyRateLimiter, rateLimiter_1.userAiRateLimiter, rateLimiter_1.companyAiRateLimiter, (0, featureGate_1.requireFeature)('ai_bot'), copilot_routes_1.default);
app.use('/api/error-logs', auth_1.authenticate, rateLimiter_1.companyRateLimiter, error_log_routes_1.default);
app.use('/api/assignment-settings', auth_1.authenticate, rateLimiter_1.companyRateLimiter, assignment_settings_routes_1.default);
app.use('/api', finance_routes_1.default);
// 404 handler
app.use((req, res) => {
    const requestId = req.requestId;
    res.status(404).json({ error: 'Endpoint not found', requestId });
});
// Sentry error handler — must be BEFORE the generic error handler and AFTER all routes.
// Only active when SENTRY_DSN is configured.
if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
}
// Global error handler - does NOT leak internal details
app.use((err, req, res, _next) => {
    const requestId = req.requestId;
    logger_1.default.error('Unhandled error', { message: err.message, stack: err.stack, requestId });
    // Capture in Sentry if not already handled by the Sentry error handler middleware
    if (!process.env.SENTRY_DSN) {
        Sentry.captureException(err);
    }
    res.status(500).json({ error: 'Internal server error', requestId });
});
exports.default = app;
