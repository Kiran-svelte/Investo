"use strict";
/**
 * Constants for the WhatsApp Agentic AI system.
 * All magic numbers, keyword lists, emoji maps, and cron schedules
 * are centralized here to avoid duplication across agent services.
 * @module constants/agent-ai
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INDIAN_LOCALE = exports.IST_TIMEZONE = exports.USER_ROLE_LABELS = exports.LEAD_SOURCE_LABELS = exports.LEAD_STATUS_EMOJI = exports.VISIT_STATUS_EMOJI = exports.CRON_SCHEDULES = exports.CONFIRMATION_REQUIRED_ACTIONS = exports.CONFIRMATION_NEGATIVE_KEYWORDS = exports.CONFIRMATION_POSITIVE_KEYWORDS = exports.DEFAULT_LIST_LIMIT = exports.DEFAULT_AGENT_TEMPERATURE = exports.CONFIRMATION_TTL_MS = exports.DEFAULT_MESSAGE_WINDOW_SIZE = exports.MAX_TOOL_CALLS_PER_MESSAGE = void 0;
// ─── Safety Limits ──────────────────────────────────────────────────
/** Maximum tool calls per single user message to prevent runaway agents */
exports.MAX_TOOL_CALLS_PER_MESSAGE = 10;
/** Default sliding window size for conversation history sent to LLM */
exports.DEFAULT_MESSAGE_WINDOW_SIZE = 20;
/** Confirmation timeout in milliseconds (5 minutes) */
exports.CONFIRMATION_TTL_MS = 5 * 60 * 1000;
/** Default LLM temperature for agent responses (low for deterministic tool calling) */
exports.DEFAULT_AGENT_TEMPERATURE = 0.1;
/** Maximum results returned per list query to keep WhatsApp messages readable */
exports.DEFAULT_LIST_LIMIT = 5;
// ─── Confirmation Keywords (Multilingual) ───────────────────────────
/** Keywords that indicate positive confirmation */
exports.CONFIRMATION_POSITIVE_KEYWORDS = new Set([
    'yes', 'y', 'confirm', 'haan', 'ha', 'ok', 'sure', 'proceed',
    'haa', 'aam', 'do it', 'go ahead', 'approved',
]);
/** Keywords that indicate rejection / cancellation */
exports.CONFIRMATION_NEGATIVE_KEYWORDS = new Set([
    'no', 'n', 'cancel', 'nahi', 'nah', 'stop', 'abort',
    'ruko', 'mat karo', 'reject', 'skip', 'leave it',
]);
// ─── Actions Requiring Confirmation ─────────────────────────────────
/** Destructive actions that must ask the user "Are you sure?" before executing */
exports.CONFIRMATION_REQUIRED_ACTIONS = new Set([
    'deleteLead',
    'deactivateAgent',
    'cancelVisit',
    'closeLeadLost',
    'bulkUpdateVisits',
    'reassignLead',
]);
// ─── Cron Schedules (UTC — IST is UTC+5:30) ────────────────────────
/** Cron expressions for proactive WhatsApp notifications */
exports.CRON_SCHEDULES = {
    /** Morning briefing for agents — 8:30 AM IST = 03:00 UTC */
    MORNING_BRIEFING: '0 3 * * 1-6',
    /** End-of-day summary for agents — 6:30 PM IST = 13:00 UTC */
    END_OF_DAY_SUMMARY: '0 13 * * 1-6',
    /** Weekly admin performance report — Monday 9:00 AM IST = 03:30 UTC */
    WEEKLY_ADMIN_REPORT: '30 3 * * 1',
    /** Check for upcoming visits and send reminders — every 15 minutes */
    VISIT_REMINDER_CHECK: '*/15 * * * *',
    /** Morning follow-up alert for agents — 9:30 AM IST = 04:00 UTC */
    FOLLOW_UP_ALERT: '0 4 * * 1-6',
    /** Weekly stale lead alert for admins — Monday 10:30 AM IST = 05:00 UTC */
    STALE_LEAD_ALERT: '0 5 * * 1',
    /** Clean up expired pending confirmations — every 5 minutes */
    EXPIRED_CONFIRMATION_CLEANUP: '*/5 * * * *',
};
// ─── Emoji Maps ─────────────────────────────────────────────────────
/** Emoji indicators for visit statuses */
exports.VISIT_STATUS_EMOJI = {
    scheduled: '⏳',
    confirmed: '✅',
    completed: '✔️',
    cancelled: '❌',
    no_show: '🚫',
};
/** Emoji indicators for lead pipeline statuses */
exports.LEAD_STATUS_EMOJI = {
    new: '🆕',
    contacted: '📞',
    visit_scheduled: '📅',
    visited: '🏠',
    negotiation: '🤝',
    closed_won: '🎉',
    closed_lost: '💔',
};
/** Human-readable labels with emoji for lead sources */
exports.LEAD_SOURCE_LABELS = {
    whatsapp: '📱 WhatsApp',
    website: '🌐 Website',
    manual: '✍️ Manual',
    referral: '🤝 Referral',
};
// ─── User Role Labels ───────────────────────────────────────────────
/** Human-readable labels for user roles */
exports.USER_ROLE_LABELS = {
    super_admin: '🛡️ Super Admin',
    company_admin: '👔 Admin',
    sales_agent: '👨‍💼 Sales Agent',
    operations: '⚙️ Operations',
    viewer: '👁️ Viewer',
};
// ─── IST Timezone ───────────────────────────────────────────────────
/** IANA timezone identifier for India Standard Time */
exports.IST_TIMEZONE = 'Asia/Kolkata';
/** Locale for Indian number and date formatting */
exports.INDIAN_LOCALE = 'en-IN';
