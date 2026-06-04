/**
 * Production readiness pillars — surfaced on /api/health for deploy verification.
 */
export const PRODUCTION_POLISH_PILLARS = {
  error_handling: {
    status: 'ready',
    items: ['Global 500 handler', 'withRetry utility', 'OpenAI backoff', 'Queue job retries', 'WhatsApp graceful fallbacks'],
  },
  logging_monitoring: {
    status: 'ready',
    items: ['Structured HTTP request logs', 'X-Request-Id', 'Ops metrics snapshot', 'Error log API', 'Health + readiness'],
  },
  security_compliance: {
    status: 'ready',
    items: ['Helmet', 'CORS allowlist', 'JWT auth', 'Tenant isolation', 'Rate limits (user/company/AI/webhook)', 'Log redaction', 'docs/SECURITY.md'],
  },
  performance_scaling: {
    status: 'ready',
    items: ['Redis cache + rate counters', 'Dashboard analytics cache', 'Property import worker', 'Automation queue'],
  },
  user_experience: {
    status: 'ready',
    items: ['Message polish', 'Typing + read receipts (Meta)', 'Human reply delay', 'Interactive buttons/lists', 'Staff CRM shortcuts'],
  },
  analytics_reporting: {
    status: 'ready',
    items: ['/api/analytics/dashboard', 'Agency owner AnalyticsPage', 'Agent analytics tools', 'Ops counters'],
  },
  testing_qa: {
    status: 'ready',
    items: ['Jest unit tests', 'Workflow scenario matrix', 'E2E Playwright', 'Production smoke scripts'],
  },
  backup_disaster_recovery: {
    status: 'ready',
    items: ['docs/DISASTER_RECOVERY.md', 'scripts/backup-database.ps1', 'Provider-managed DB backups (Neon/Supabase)'],
  },
  documentation: {
    status: 'ready',
    items: ['docs/PRODUCTION_POLISH.md', 'docs/ARCHITECTURE.md', 'USER_GUIDE.md', 'WORKFLOW_ENGINE.md'],
  },
  branding_polish: {
    status: 'ready',
    items: ['WhatsApp *bold* formatting', 'Company name in outbound footer', 'Consistent copilot tone'],
  },
} as const;
