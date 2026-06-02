"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDateIST = formatDateIST;
exports.formatCurrencyINR = formatCurrencyINR;
exports.maskPhone = maskPhone;
exports.getStatusEmoji = getStatusEmoji;
exports.getISTDayBounds = getISTDayBounds;
exports.getTodayIST = getTodayIST;
exports.truncate = truncate;
exports.isAdminRole = isAdminRole;
exports.buildAgentScopeFilter = buildAgentScopeFilter;
const agent_tools_constants_1 = require("../../../constants/agent-tools.constants");
function formatDateIST(date) {
    return new Intl.DateTimeFormat(agent_tools_constants_1.INDIA_LOCALE, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: agent_tools_constants_1.IST_TIMEZONE,
    }).format(date);
}
function formatCurrencyINR(amount) {
    const numeric = typeof amount === 'number'
        ? amount
        : typeof amount === 'string'
            ? Number(amount)
            : amount?.toNumber?.() ?? 0;
    return new Intl.NumberFormat(agent_tools_constants_1.INDIA_LOCALE, {
        style: 'currency',
        currency: agent_tools_constants_1.INR_CURRENCY,
        maximumFractionDigits: 0,
    }).format(Number.isFinite(numeric) ? numeric : 0);
}
function maskPhone(phone) {
    if (!phone)
        return 'N/A';
    const cleaned = phone.replace(/\s+/g, '');
    const visible = agent_tools_constants_1.PHONE_VISIBLE_PREFIX_LENGTH + agent_tools_constants_1.PHONE_VISIBLE_SUFFIX_LENGTH;
    if (cleaned.length <= visible)
        return cleaned;
    return `${cleaned.slice(0, agent_tools_constants_1.PHONE_VISIBLE_PREFIX_LENGTH)}${agent_tools_constants_1.PHONE_MASK_CHAR.repeat(cleaned.length - visible)}${cleaned.slice(-agent_tools_constants_1.PHONE_VISIBLE_SUFFIX_LENGTH)}`;
}
function getStatusEmoji(status) {
    return agent_tools_constants_1.STATUS_EMOJI[status] ?? '';
}
function getISTDayBounds(dateString) {
    return [
        new Date(`${dateString}T00:00:00+05:30`),
        new Date(`${dateString}T23:59:59.999+05:30`),
    ];
}
function getTodayIST() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: agent_tools_constants_1.IST_TIMEZONE });
}
function truncate(text, maxLength) {
    if (text.length <= maxLength)
        return text;
    return `${text.slice(0, Math.max(maxLength - 3, 0))}...`;
}
function isAdminRole(role) {
    return role === 'company_admin' || role === 'super_admin';
}
function buildAgentScopeFilter(companyId, userRole, userId, agentField = 'assignedAgentId') {
    const filter = { companyId };
    if (userRole === 'sales_agent')
        filter[agentField] = userId;
    return filter;
}
