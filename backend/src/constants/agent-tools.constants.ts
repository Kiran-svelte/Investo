/** Default maximum results returned in list queries */
export const DEFAULT_LIST_LIMIT = 5;

/** Maximum results a user can request in a single list query */
export const MAX_LIST_LIMIT = 20;

/** Maximum results for conversation message history */
export const DEFAULT_MESSAGE_LIMIT = 15;

/** Maximum message history a user can request */
export const MAX_MESSAGE_LIMIT = 50;

/** Default notification fetch limit */
export const DEFAULT_NOTIFICATION_LIMIT = 10;

/** Maximum audit log entries returned */
export const DEFAULT_AUDIT_LOG_LIMIT = 20;

/** IST timezone identifier for date formatting */
export const IST_TIMEZONE = 'Asia/Kolkata';

/** Locale for Indian formatting (dates, currency) */
export const INDIA_LOCALE = 'en-IN';

/** Currency code for Indian Rupees */
export const INR_CURRENCY = 'INR';

/** Roles permitted to perform admin-only operations */
export const ADMIN_ROLES: ReadonlySet<string> = new Set(['super_admin', 'company_admin']);

/** Lead statuses that allow automatic upgrade to visit_scheduled */
export const LEAD_STATUSES_FOR_AUTO_VISIT_UPGRADE: ReadonlySet<string> = new Set(['new', 'contacted']);

/** Start hour for available visit slots (24-hour format) */
export const SLOT_START_HOUR = 9;

/** End hour for available visit slots (24-hour format) */
export const SLOT_END_HOUR = 18;

/** Duration of a single visit slot in minutes */
export const SLOT_DURATION_MINUTES = 60;

/** Number of months to convert to milliseconds: 1 month ≈ 30 days */
export const DAYS_IN_MONTH = 30;

/** Bcrypt salt rounds for password hashing */
export const BCRYPT_SALT_ROUNDS = 12;

/** Phone mask character */
export const PHONE_MASK_CHAR = 'X';

/** Minimum digits shown at start of masked phone */
export const PHONE_VISIBLE_PREFIX_LENGTH = 4;

/** Minimum digits shown at end of masked phone */
export const PHONE_VISIBLE_SUFFIX_LENGTH = 2;

/** Emoji used for visit status badges */
export const STATUS_EMOJI: Record<string, string> = {
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
export const PERCENTAGE_BASIS = 100;
