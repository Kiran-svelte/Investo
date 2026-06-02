"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ONBOARDING_ROLES = exports.DEFAULT_ONBOARDING_FEATURES = void 0;
exports.DEFAULT_ONBOARDING_FEATURES = [
    'ai_bot',
    'analytics',
    'visit_scheduling',
    'notifications',
    'agent_management',
    'conversation_center',
    'lead_automation',
    'property_management',
    'audit_logs',
    'csv_export',
];
exports.DEFAULT_ONBOARDING_ROLES = [
    {
        roleName: 'sales_agent',
        displayName: 'Sales Agent',
        permissions: {
            leads: ['read', 'update'],
            properties: ['read'],
            conversations: ['read'],
            visits: ['create', 'read', 'update'],
            analytics: ['read'],
            notifications: ['read', 'update'],
        },
    },
    {
        roleName: 'operations',
        displayName: 'Operations',
        permissions: {
            leads: ['read'],
            properties: ['read'],
            conversations: ['read'],
            visits: ['read', 'update'],
            analytics: ['read'],
            notifications: ['read', 'update'],
        },
    },
    {
        roleName: 'viewer',
        displayName: 'Viewer',
        permissions: {
            leads: ['read'],
            properties: ['read'],
            visits: ['read'],
            analytics: ['read'],
            audit_logs: ['read'],
            notifications: ['read'],
        },
    },
];
