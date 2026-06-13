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
    /** Morning briefing for agents - 9:00 AM IST = 03:30 UTC */
    MORNING_BRIEFING: '30 3 * * 1-6',
    /** Daily owner summary - 9:15 AM IST = 03:45 UTC (staggered from MORNING_BRIEFING to avoid simultaneous messages) */
    OWNER_DAILY_SUMMARY: '45 3 * * 1-6',
    /** End-of-day summary for agents — 6:30 PM IST = 13:00 UTC */
    END_OF_DAY_SUMMARY: '0 13 * * 1-6',
    /** Weekly admin performance report — Monday 9:00 AM IST = 03:30 UTC */
    WEEKLY_ADMIN_REPORT: '30 3 * * 1',
    /** Check for upcoming confirmed visits and send reminders — every 15 minutes */
    VISIT_REMINDER_CHECK: '*/15 * * * *',
    /** Morning follow-up alert for agents — 9:00 AM IST = 03:30 UTC (24h SLA) */
    FOLLOW_UP_ALERT: '30 3 * * 1-6',
    /** Weekly stale lead alert for admins — Monday 10:30 AM IST = 05:00 UTC */
    STALE_LEAD_ALERT: '0 5 * * 1',
    /** Clean up expired pending confirmations — every 5 minutes */
    EXPIRED_CONFIRMATION_CLEANUP: '*/5 * * * *',
    /** Auto-detect no-show visits (30 min past scheduled time) — every 30 minutes */
    NO_SHOW_CHECK: '*/30 * * * *',
    /** Alert agents about hot leads with no contact in 4h — every 4h Mon-Sat */
    HOT_LEAD_SLA_CHECK: '0 */4 * * 1-6',
    /** Per-agent weekly pipeline WhatsApp — Monday 9:00 AM IST = 03:30 UTC */
    AGENT_WEEKLY_PIPELINE: '30 3 * * 1',
    /** Nudge agent 2h after a visit is marked completed — every 2 hours */
    VISIT_COMPLETED_NUDGE: '0 */2 * * *',
    /** Monthly full report to admins — 1st of month 9:00 AM IST = 03:30 UTC */
    MONTHLY_ADMIN_REPORT: '30 3 1 * *',
    /** Purge AgentActionLog entries older than 90 days — nightly at 2:00 AM IST = 20:30 UTC */
    ACTION_LOG_PURGE: '30 20 * * *',
    /** Auto-decline pending visit/call approvals older than 4 hours — every 30 minutes */
    PENDING_APPROVAL_EXPIRE: '*/30 * * * *',
    /** EOD attendance check — 7:00 PM IST = 13:30 UTC Mon-Sat.
     *  Asks agents "Did the customer show up?" (YES/NO) for unresolved today-visits. */
    EOD_ATTENDANCE_CHECK: '30 13 * * 1-6',
    /**
     * Workflow saga reconciliation check — 2:30 AM IST = 21:00 UTC nightly.
     * Alerts super_admin and logs every `needs_reconciliation` workflow run
     * that has not been manually resolved within 24 hours.
     * Owner: on-call team. Runbook: docs/runbooks/workflow-reconciliation.md
     */
    WORKFLOW_RECONCILIATION_CHECK: '0 21 * * *',
    /**
     * Nightly conversation summary — 2:10 AM IST = 20:40 UTC.
     * Patches lead_memory.conversationSummary for leads active in the last 24 h
     * so the buyer AI never loses long-thread continuity.
     * Capped at 200 leads per run; idempotent.
     * TTL: no fixed TTL — summary is overwritten on each run.
     * Owner: G13 in AI_MASTER_REALITY_AND_A_PLUS_PLAN.md
     */
    NIGHTLY_CONVERSATION_SUMMARY: '40 20 * * *',
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
