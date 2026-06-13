"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getToolsForRole = getToolsForRole;
const admin_tools_1 = require("./admin-tools");
const admin_log_tools_1 = require("./admin-log-tools");
const analytics_tools_1 = require("./analytics-tools");
const brochure_tools_1 = require("./brochure-tools");
const bulk_message_tools_1 = require("./bulk-message-tools");
const calendar_tools_1 = require("./calendar-tools");
const conversation_tools_1 = require("./conversation-tools");
const emi_tools_1 = require("./emi-tools");
const lead_tools_1 = require("./lead-tools");
const notification_tools_1 = require("./notification-tools");
const property_tools_1 = require("./property-tools");
const user_tools_1 = require("./user-tools");
const visit_tools_1 = require("./visit-tools");
const workflow_tools_1 = require("./workflow-tools");
function isAdminRole(role) {
    return role === 'company_admin' || role === 'super_admin';
}
function isOperationsRole(role) {
    return role === 'operations';
}
/**
 * Returns the full tool set available to the calling user based on their role.
 * All tools enforce their own internal permission checks as a second layer.
 *
 * @param context - Caller's identity and company scope.
 * @returns Flat array of agent tools scoped to the caller's role.
 */
function getToolsForRole(context) {
    if (context.userRole === 'viewer') {
        return [
            ...(0, property_tools_1.createPropertyTools)(context),
            ...(0, analytics_tools_1.createAnalyticsTools)(context),
            ...(0, calendar_tools_1.createCalendarTools)(context),
            ...(0, emi_tools_1.createEmiTools)(context),
        ];
    }
    const tools = [
        ...(0, property_tools_1.createPropertyTools)(context),
        ...(0, notification_tools_1.createNotificationTools)(context),
        ...(0, emi_tools_1.createEmiTools)(context),
        ...(0, brochure_tools_1.createBrochureTools)(context),
    ];
    if (isOperationsRole(context.userRole)) {
        tools.push(...(0, lead_tools_1.createLeadReadTools)(context), ...(0, visit_tools_1.createVisitTools)(context), ...(0, calendar_tools_1.createCalendarTools)(context), ...(0, analytics_tools_1.createAnalyticsTools)(context));
        return tools;
    }
    const isAdmin = isAdminRole(context.userRole);
    if (context.userRole === 'sales_agent' || isAdmin) {
        tools.push(...(0, workflow_tools_1.createWorkflowTools)(context), ...(0, visit_tools_1.createVisitTools)(context), ...(0, lead_tools_1.createLeadReadTools)(context), ...(0, lead_tools_1.createLeadMutationTools)(context, {
            allowCreate: isAdmin,
            allowAssign: isAdmin,
            allowPortfolioTransfer: isAdmin,
        }), ...(0, conversation_tools_1.createConversationTools)(context), ...(0, bulk_message_tools_1.createBulkMessageTools)(context), ...(0, calendar_tools_1.createCalendarTools)(context), ...(0, analytics_tools_1.createAnalyticsTools)(context));
    }
    if (isAdmin) {
        tools.push(...(0, user_tools_1.createUserTools)(context), ...(0, admin_tools_1.createAdminTools)(context), ...(0, admin_log_tools_1.createAdminLogTools)(context));
    }
    return tools;
}
