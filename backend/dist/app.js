"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
// All other routes with company-level rate limiting (1000 req/min per company)
app.use('/api/companies', rateLimiter_1.companyRateLimiter, company_routes_1.default);
app.use('/api/users', rateLimiter_1.companyRateLimiter, user_routes_1.default);
app.use('/api/leads', rateLimiter_1.companyRateLimiter, lead_routes_1.default);
app.use('/api/property-projects', rateLimiter_1.companyRateLimiter, property_project_routes_1.default);
app.use('/api/properties', rateLimiter_1.companyRateLimiter, property_routes_1.default);
// Public upload endpoint (no auth headers) must be mounted before the authenticated router.
app.use('/api/property-imports/uploads', property_import_upload_routes_1.default);
// Bulk CSV/XLSX import must be mounted before the main router (prevents /:id wildcard capturing /bulk).
app.use('/api/property-imports/bulk', rateLimiter_1.companyRateLimiter, property_import_bulk_routes_1.default);
app.use('/api/property-imports', rateLimiter_1.companyRateLimiter, rateLimiter_1.userAiRateLimiter, rateLimiter_1.companyAiRateLimiter, property_import_routes_1.default);
app.use('/api/visits', rateLimiter_1.companyRateLimiter, visit_routes_1.default);
app.use('/api/conversations', rateLimiter_1.companyRateLimiter, conversation_routes_1.default);
app.use('/api/ai-settings', rateLimiter_1.companyRateLimiter, ai_settings_routes_1.default);
app.use('/api/conversion-settings', rateLimiter_1.companyRateLimiter, conversion_settings_routes_1.default);
app.use('/api/analytics', rateLimiter_1.companyRateLimiter, analytics_routes_1.default);
app.use('/api/notifications', rateLimiter_1.companyRateLimiter, notification_routes_1.default);
app.use('/api/subscriptions', rateLimiter_1.companyRateLimiter, subscription_routes_1.default);
app.use('/api/admin', rateLimiter_1.companyRateLimiter, admin_routes_1.default);
app.use('/api/roles', rateLimiter_1.companyRateLimiter, role_routes_1.default);
app.use('/api/features', rateLimiter_1.companyRateLimiter, feature_routes_1.default);
app.use('/api/onboarding', rateLimiter_1.companyRateLimiter, onboarding_routes_1.default);
app.use('/api/audit', rateLimiter_1.companyRateLimiter, audit_routes_1.default);
app.use('/api/agent-action-logs', rateLimiter_1.companyRateLimiter, agent_action_log_routes_1.default);
app.use('/api/copilot', rateLimiter_1.companyRateLimiter, rateLimiter_1.companyAiRateLimiter, copilot_routes_1.default);
app.use('/api/error-logs', rateLimiter_1.companyRateLimiter, error_log_routes_1.default);
app.use('/api/assignment-settings', rateLimiter_1.companyRateLimiter, assignment_settings_routes_1.default);
app.use('/api', finance_routes_1.default);
// 404 handler
app.use((req, res) => {
    const requestId = req.requestId;
    res.status(404).json({ error: 'Endpoint not found', requestId });
});
// Global error handler - does NOT leak internal details
app.use((err, req, res, _next) => {
    const requestId = req.requestId;
    logger_1.default.error('Unhandled error', { message: err.message, stack: err.stack, requestId });
    res.status(500).json({ error: 'Internal server error', requestId });
});
exports.default = app;
