"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const logger_1 = __importDefault(require("./config/logger"));
const rateLimiter_1 = require("./middleware/rateLimiter");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const company_routes_1 = __importDefault(require("./routes/company.routes"));
const user_routes_1 = __importDefault(require("./routes/user.routes"));
const lead_routes_1 = __importDefault(require("./routes/lead.routes"));
const property_routes_1 = __importDefault(require("./routes/property.routes"));
const visit_routes_1 = __importDefault(require("./routes/visit.routes"));
const conversation_routes_1 = __importDefault(require("./routes/conversation.routes"));
const ai_settings_routes_1 = __importDefault(require("./routes/ai-settings.routes"));
const conversion_settings_routes_1 = __importDefault(require("./routes/conversion-settings.routes"));
const webhook_routes_1 = __importDefault(require("./routes/webhook.routes"));
const health_routes_1 = __importDefault(require("./routes/health.routes"));
const readiness_routes_1 = __importDefault(require("./routes/readiness.routes"));
const analytics_routes_1 = __importDefault(require("./routes/analytics.routes"));
const notification_routes_1 = __importDefault(require("./routes/notification.routes"));
const subscription_routes_1 = __importDefault(require("./routes/subscription.routes"));
const admin_routes_1 = __importDefault(require("./routes/admin.routes"));
const role_routes_1 = __importDefault(require("./routes/role.routes"));
const feature_routes_1 = __importDefault(require("./routes/feature.routes"));
const onboarding_routes_1 = __importDefault(require("./routes/onboarding.routes"));
const audit_routes_1 = __importDefault(require("./routes/audit.routes"));
const property_import_routes_1 = __importDefault(require("./routes/property-import.routes"));
const property_import_upload_routes_1 = __importDefault(require("./routes/property-import-upload.routes"));
const finance_routes_1 = __importDefault(require("./routes/finance.routes"));
const config_1 = require("./config");
const greenapi_webhook_routes_1 = __importDefault(require("./routes/greenapi-webhook.routes"));
const app = (0, express_1.default)();
// Render/other reverse proxies forward client IP via X-Forwarded-For.
// express-rate-limit requires trust proxy to be enabled to avoid ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);
// Security headers
app.use((0, helmet_1.default)());
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
// Webhook routes (no rate limiting - verified by signature)
// IMPORTANT: This must run before global JSON parsing so we can verify signatures against raw request bytes.
app.use('/api/webhook', webhook_routes_1.default);
// GreenAPI webhook route (guarded internally for production)
app.use('/api/greenapi/webhook', greenapi_webhook_routes_1.default);
// Body parsing (for all non-webhook routes)
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
// Global rate limiting (per user: 100 req/min)
app.use('/api/', rateLimiter_1.userRateLimiter);
// Auth routes with stricter rate limiting for login
app.use('/api/auth', rateLimiter_1.sensitiveRateLimiter, auth_routes_1.default);
// All other routes with company-level rate limiting (1000 req/min per company)
app.use('/api/companies', rateLimiter_1.companyRateLimiter, company_routes_1.default);
app.use('/api/users', rateLimiter_1.companyRateLimiter, user_routes_1.default);
app.use('/api/leads', rateLimiter_1.companyRateLimiter, lead_routes_1.default);
app.use('/api/properties', rateLimiter_1.companyRateLimiter, property_routes_1.default);
// Public upload endpoint (no auth headers) must be mounted before the authenticated router.
app.use('/api/property-imports/uploads', property_import_upload_routes_1.default);
app.use('/api/property-imports', rateLimiter_1.companyRateLimiter, property_import_routes_1.default);
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
app.use('/api', finance_routes_1.default);
// 404 handler
app.use((_req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});
// Global error handler - does NOT leak internal details
app.use((err, _req, res, _next) => {
    logger_1.default.error('Unhandled error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
});
exports.default = app;
