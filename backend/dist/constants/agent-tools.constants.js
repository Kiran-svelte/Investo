"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERCENTAGE_BASIS = exports.STATUS_EMOJI = exports.PHONE_VISIBLE_SUFFIX_LENGTH = exports.PHONE_VISIBLE_PREFIX_LENGTH = exports.PHONE_MASK_CHAR = exports.BCRYPT_SALT_ROUNDS = exports.DAYS_IN_MONTH = exports.SLOT_DURATION_MINUTES = exports.SLOT_END_HOUR = exports.SLOT_START_HOUR = exports.LEAD_STATUSES_FOR_AUTO_VISIT_UPGRADE = exports.ADMIN_ROLES = exports.INR_CURRENCY = exports.INDIA_LOCALE = exports.IST_TIMEZONE = exports.DEFAULT_AUDIT_LOG_LIMIT = exports.DEFAULT_NOTIFICATION_LIMIT = exports.MAX_MESSAGE_LIMIT = exports.DEFAULT_MESSAGE_LIMIT = exports.MAX_LIST_LIMIT = exports.DEFAULT_LIST_LIMIT = void 0;
/** Default maximum results returned in list queries */
exports.DEFAULT_LIST_LIMIT = 5;
/** Maximum results a user can request in a single list query */
exports.MAX_LIST_LIMIT = 20;
/** Maximum results for conversation message history */
exports.DEFAULT_MESSAGE_LIMIT = 15;
/** Maximum message history a user can request */
exports.MAX_MESSAGE_LIMIT = 50;
/** Default notification fetch limit */
exports.DEFAULT_NOTIFICATION_LIMIT = 10;
/** Maximum audit log entries returned */
exports.DEFAULT_AUDIT_LOG_LIMIT = 20;
/** IST timezone identifier for date formatting */
exports.IST_TIMEZONE = 'Asia/Kolkata';
/** Locale for Indian formatting (dates, currency) */
exports.INDIA_LOCALE = 'en-IN';
/** Currency code for Indian Rupees */
exports.INR_CURRENCY = 'INR';
/** Roles permitted to perform admin-only operations */
exports.ADMIN_ROLES = new Set(['super_admin', 'company_admin']);
/** Lead statuses that allow automatic upgrade to visit_scheduled */
exports.LEAD_STATUSES_FOR_AUTO_VISIT_UPGRADE = new Set(['new', 'contacted']);
/** Start hour for available visit slots (24-hour format) */
exports.SLOT_START_HOUR = 9;
/** End hour for available visit slots (24-hour format) */
exports.SLOT_END_HOUR = 18;
/** Duration of a single visit slot in minutes */
exports.SLOT_DURATION_MINUTES = 60;
/** Number of months to convert to milliseconds: 1 month ≈ 30 days */
exports.DAYS_IN_MONTH = 30;
/** Bcrypt salt rounds for password hashing */
exports.BCRYPT_SALT_ROUNDS = 12;
/** Phone mask character */
exports.PHONE_MASK_CHAR = 'X';
/** Minimum digits shown at start of masked phone */
exports.PHONE_VISIBLE_PREFIX_LENGTH = 4;
/** Minimum digits shown at end of masked phone */
exports.PHONE_VISIBLE_SUFFIX_LENGTH = 2;
/** Emoji used for visit status badges */
exports.STATUS_EMOJI = {
    scheduled: '📅',
    confirmed: '✅',
    completed: '✔️',
    cancelled: '❌',
    no_show: '🚫',
    new: '🆕',
    contacted: '📞',
    visit_scheduled: '📅',
    visited: '🏠',
    negotiation: '🤝',
    closed_won: '🎉',
    closed_lost: '💔',
    available: '🟢',
    sold: '🔴',
    upcoming: '🟡',
    ai_active: '🤖',
    agent_active: '👤',
    closed: '🔒',
    pass: '✅',
    fail: '❌',
    warn: '⚠️',
};
/** Percentage basis for conversion rate calculations */
exports.PERCENTAGE_BASIS = 100;
