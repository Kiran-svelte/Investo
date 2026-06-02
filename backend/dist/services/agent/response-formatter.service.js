"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDateIST = formatDateIST;
exports.formatTimeIST = formatTimeIST;
exports.formatCurrencyINR = formatCurrencyINR;
exports.maskPhone = maskPhone;
exports.visitStatusEmoji = visitStatusEmoji;
exports.leadStatusEmoji = leadStatusEmoji;
exports.decimalToNumber = decimalToNumber;
const agent_ai_constants_1 = require("../../constants/agent-ai.constants");
const format_helpers_1 = require("./tools/format-helpers");
function formatDateIST(date) {
    return new Intl.DateTimeFormat(agent_ai_constants_1.INDIAN_LOCALE, {
        timeZone: agent_ai_constants_1.IST_TIMEZONE,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    }).format(date);
}
function formatTimeIST(date) {
    return new Intl.DateTimeFormat(agent_ai_constants_1.INDIAN_LOCALE, {
        timeZone: agent_ai_constants_1.IST_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    }).format(date);
}
function formatCurrencyINR(amount) {
    return (0, format_helpers_1.formatCurrencyINR)(amount);
}
function maskPhone(phone) {
    if (!phone)
        return 'N/A';
    const cleaned = phone.replace(/\s+/g, '');
    if (cleaned.length < 8)
        return cleaned;
    return `${cleaned.slice(0, 4)}${'X'.repeat(Math.max(cleaned.length - 6, 0))}${cleaned.slice(-2)}`;
}
function visitStatusEmoji(status) {
    return agent_ai_constants_1.VISIT_STATUS_EMOJI[status] ?? '';
}
function leadStatusEmoji(status) {
    return agent_ai_constants_1.LEAD_STATUS_EMOJI[status] ?? '';
}
function decimalToNumber(value) {
    if (typeof value === 'number')
        return value;
    if (typeof value === 'string')
        return Number(value) || 0;
    if (value && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
        return value.toNumber();
    }
    return 0;
}
