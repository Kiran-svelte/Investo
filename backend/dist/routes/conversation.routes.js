"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const tenant_1 = require("../middleware/tenant");
const audit_1 = require("../middleware/audit");
const featureGate_1 = require("../middleware/featureGate");
const propertyCompletenessGate_1 = require("../middleware/propertyCompletenessGate");
const validation_1 = require("../models/validation");
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const whatsapp_service_1 = require("../services/whatsapp.service");
const socket_service_1 = require("../services/socket.service");
const pagination_1 = require("../utils/pagination");
const resourceDelete_service_1 = require("../services/resourceDelete.service");
const companyWhatsAppConfig_util_1 = require("../utils/companyWhatsAppConfig.util");
const router = (0, express_1.Router)();
function handleDeleteError(err, res) {
    if (err instanceof resourceDelete_service_1.ResourceDeleteError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
    }
    const message = err instanceof Error ? err.message : 'Delete failed';
    logger_1.default.error('Delete failed', { error: message });
    res.status(500).json({ error: message });
}
router.use(auth_1.authenticate);
router.use(tenant_1.tenantIsolation);
router.use(propertyCompletenessGate_1.propertyCompletenessGate);
router.use((0, featureGate_1.requireFeature)('conversation_center'));
function normalizeWhatsAppConfig(company) {
    return (0, companyWhatsAppConfig_util_1.resolveCompanyWhatsAppConfigFromSettings)(company.settings) ?? {
        provider: 'meta',
        phoneNumberId: '',
        accessToken: '',
        verifyToken: '',
    };
}
function toIsoString(value) {
    return value ? value.toISOString() : null;
}
function mapMessageToDTO(msg) {
    return {
        id: msg.id,
        sender_type: msg.senderType,
        content: msg.content,
        language: msg.language,
        whatsapp_message_id: msg.whatsappMessageId,
        status: msg.status,
        created_at: msg.createdAt?.toISOString?.() || msg.createdAt,
    };
}
function mapConversationToSnakeCaseDTO(conv, options) {
    return {
        id: conv.id,
        company_id: conv.companyId,
        lead_id: conv.leadId,
        whatsapp_phone: conv.whatsappPhone,
        status: conv.status,
        language: conv.language,
        ai_enabled: conv.aiEnabled,
        stage: conv.stage,
        stage_entered_at: toIsoString(conv.stageEnteredAt),
        stage_message_count: conv.stageMessageCount,
        commitments: conv.commitments,
        objection_count: conv.objectionCount,
        last_objection_type: conv.lastObjectionType,
        consecutive_objections: conv.consecutiveObjections,
        urgency_score: conv.urgencyScore,
        value_score: conv.valueScore,
        escalation_reason: conv.escalationReason,
        escalated_at: toIsoString(conv.escalatedAt),
        recommended_property_ids: conv.recommendedPropertyIds,
        selected_property_id: conv.selectedPropertyId,
        proposed_visit_time: toIsoString(conv.proposedVisitTime),
        created_at: toIsoString(conv.createdAt),
        updated_at: toIsoString(conv.updatedAt),
        customer_name: conv.lead?.customerName || null,
        customer_phone: conv.lead?.phone || conv.whatsappPhone,
        assigned_agent_id: conv.lead?.assignedAgentId || null,
        last_message: options?.lastMessage ? mapMessageToDTO(options.lastMessage) : null,
    };
}
function buildMessageContent(payload) {
    if (payload.mode === 'text') {
        return payload.text;
    }
    if (payload.mode === 'document') {
        const fileName = payload.filename?.trim() || 'document.pdf';
        const caption = payload.caption?.trim();
        return caption
            ? `${caption}\n\n[Document] ${fileName}: ${payload.document_url}`
            : `[Document] ${fileName}: ${payload.document_url}`;
    }
    const buttonTitles = payload.buttons.map((button) => button.title).join(' | ');
    return `${payload.body_text}\n\n[Quick Replies] ${buttonTitles}`;
}
/**
 * GET /api/conversations
 * List conversations. Sales agents see only their leads' conversations.
 */
router.get('/', (0, rbac_1.authorize)('conversations', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const where = { companyId };
        if (req.user.role === 'sales_agent') {
            where.lead = { assignedAgentId: req.user.id };
        }
        const { status, search } = req.query;
        if (status)
            where.status = status;
        if (search) {
            const searchCondition = {
                OR: [
                    { customerName: { contains: search, mode: 'insensitive' } },
                    { phone: { contains: search, mode: 'insensitive' } },
                ],
            };
            if (where.lead) {
                where.lead = { ...where.lead, ...searchCondition };
            }
            else {
                where.lead = searchCondition;
            }
        }
        const { page, limit, offset } = (0, pagination_1.parsePagination)(req.query);
        const [conversations, total] = await Promise.all([
            prisma_1.default.conversation.findMany({
                where,
                include: {
                    lead: { select: { customerName: true, phone: true, assignedAgentId: true } },
                },
                orderBy: { updatedAt: 'desc' },
                skip: offset,
                take: limit,
            }),
            prisma_1.default.conversation.count({ where }),
        ]);
        // Get last message for each conversation
        const convIds = conversations.map((c) => c.id);
        const lastMessages = convIds.length > 0
            ? (await Promise.all(convIds.map((convId) => prisma_1.default.message.findFirst({
                where: { conversationId: convId },
                orderBy: { createdAt: 'desc' },
            })))).filter(Boolean)
            : [];
        const lastMsgMap = new Map(lastMessages.map((m) => [m.conversationId, m]));
        const enriched = conversations.map((conv) => mapConversationToSnakeCaseDTO(conv, { lastMessage: lastMsgMap.get(conv.id) || null }));
        res.json({
            data: enriched,
            pagination: (0, pagination_1.buildPaginationMeta)(page, limit, total),
        });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch conversations', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});
/**
 * GET /api/conversations/:id
 * Get conversation with full message history.
 */
router.get('/:id', (0, rbac_1.authorize)('conversations', 'read'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const conversation = await prisma_1.default.conversation.findFirst({
            where: { id: req.params.id, companyId },
            include: {
                lead: { select: { customerName: true, phone: true, assignedAgentId: true } },
            },
        });
        if (!conversation) {
            res.status(404).json({ error: 'Conversation not found' });
            return;
        }
        if (req.user.role === 'sales_agent' && conversation.lead?.assignedAgentId !== req.user.id) {
            res.status(403).json({ error: 'Can only view assigned conversations' });
            return;
        }
        // Paginated messages (default chronological page 1 = oldest chunk; use sort=desc for latest-first)
        const sortDesc = req.query.sort === 'desc';
        const { page, limit, offset } = (0, pagination_1.parsePagination)(req.query, {
            limit: 50,
            maxLimit: 100,
        });
        const [messages, messageTotal] = await Promise.all([
            prisma_1.default.message.findMany({
                where: { conversationId: conversation.id },
                orderBy: { createdAt: sortDesc ? 'desc' : 'asc' },
                skip: offset,
                take: limit,
            }),
            prisma_1.default.message.count({ where: { conversationId: conversation.id } }),
        ]);
        const orderedMessages = sortDesc ? [...messages].reverse() : messages;
        const dto = mapConversationToSnakeCaseDTO(conversation);
        res.json({
            data: {
                ...dto,
                messages: orderedMessages.map((msg) => mapMessageToDTO(msg)),
            },
            pagination: (0, pagination_1.buildPaginationMeta)(page, limit, messageTotal),
        });
    }
    catch (err) {
        logger_1.default.error('Failed to fetch conversation', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch conversation' });
    }
});
/**
 * PATCH /api/conversations/:id/takeover
 * Agent takes over conversation from AI.
 * Requires 'update' permission — 'read' alone is insufficient to change conversation ownership.
 */
router.patch('/:id/takeover', (0, rbac_1.authorize)('conversations', 'update'), (0, audit_1.auditLog)('takeover', 'conversations'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const conversation = await prisma_1.default.conversation.findFirst({
            where: { id: req.params.id, companyId },
            include: { lead: { select: { assignedAgentId: true } } },
        });
        if (!conversation) {
            res.status(404).json({ error: 'Conversation not found' });
            return;
        }
        if (conversation.status !== 'ai_active') {
            res.status(400).json({ error: 'Can only take over AI-active conversations' });
            return;
        }
        // Sales agents may only take over conversations assigned to them.
        if (req.user.role === 'sales_agent' &&
            conversation.lead?.assignedAgentId !== req.user.id) {
            res.status(403).json({ error: 'Can only take over conversations assigned to you' });
            return;
        }
        await prisma_1.default.conversation.update({
            where: { id: req.params.id },
            data: { status: 'agent_active', aiEnabled: false },
        });
        socket_service_1.socketService.emitToCompany(companyId, socket_service_1.SOCKET_EVENTS.CONVERSATION_UPDATED, {
            conversationId: req.params.id,
            leadId: conversation.leadId,
            trigger: 'agent_takeover',
            status: 'agent_active',
            aiEnabled: false,
            occurredAt: new Date().toISOString(),
        });
        res.json({
            message: 'Agent takeover successful',
            data: { status: 'agent_active', aiEnabled: false },
        });
    }
    catch (err) {
        logger_1.default.error('Failed to takeover conversation', { error: err.message });
        res.status(500).json({ error: 'Failed to takeover conversation' });
    }
});
/**
 * PATCH /api/conversations/:id/release
 * Agent releases conversation back to AI.
 * Requires 'update' permission — 'read' alone is insufficient to change conversation ownership.
 */
router.patch('/:id/release', (0, rbac_1.authorize)('conversations', 'update'), (0, audit_1.auditLog)('release', 'conversations'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const conversation = await prisma_1.default.conversation.findFirst({
            where: { id: req.params.id, companyId },
        });
        if (!conversation) {
            res.status(404).json({ error: 'Conversation not found' });
            return;
        }
        if (conversation.status !== 'agent_active') {
            res.status(400).json({ error: 'Can only release agent-active conversations' });
            return;
        }
        await prisma_1.default.conversation.update({
            where: { id: req.params.id },
            data: {
                status: 'ai_active',
                aiEnabled: true,
                ...(conversation.stage === 'human_escalated' && {
                    stage: 'qualify',
                    escalationReason: null,
                }),
            },
        });
        socket_service_1.socketService.emitToCompany(companyId, socket_service_1.SOCKET_EVENTS.CONVERSATION_UPDATED, {
            conversationId: req.params.id,
            leadId: conversation.leadId,
            trigger: 'agent_release',
            status: 'ai_active',
            aiEnabled: true,
            occurredAt: new Date().toISOString(),
        });
        res.json({
            message: 'Released to AI',
            data: { status: 'ai_active', aiEnabled: true },
        });
    }
    catch (err) {
        logger_1.default.error('Failed to release conversation', { error: err.message });
        res.status(500).json({ error: 'Failed to release conversation' });
    }
});
/**
 * PATCH /api/conversations/:id/close
 * Close a conversation.
 * Requires 'update' permission — closing changes conversation status permanently.
 */
router.patch('/:id/close', (0, rbac_1.authorize)('conversations', 'update'), (0, audit_1.auditLog)('close', 'conversations'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const conversation = await prisma_1.default.conversation.findFirst({
            where: { id: req.params.id, companyId },
        });
        if (!conversation) {
            res.status(404).json({ error: 'Conversation not found' });
            return;
        }
        if (conversation.status === 'closed') {
            res.status(400).json({ error: 'Conversation already closed' });
            return;
        }
        await prisma_1.default.conversation.update({
            where: { id: req.params.id },
            data: { status: 'closed' },
        });
        res.json({ message: 'Conversation closed' });
    }
    catch (err) {
        logger_1.default.error('Failed to close conversation', { error: err.message });
        res.status(500).json({ error: 'Failed to close conversation' });
    }
});
/**
 * DELETE /api/conversations/:id
 * Permanently delete a conversation and all messages.
 */
router.delete('/:id', (0, rbac_1.authorize)('conversations', 'delete'), (0, audit_1.auditLog)('delete', 'conversations'), async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const conversation = await prisma_1.default.conversation.findFirst({
            where: { id: req.params.id, companyId },
            include: { lead: { select: { assignedAgentId: true } } },
        });
        if (!conversation) {
            res.status(404).json({ error: 'Conversation not found' });
            return;
        }
        if (req.user.role === 'sales_agent' &&
            conversation.lead?.assignedAgentId !== req.user.id) {
            res.status(403).json({ error: 'Can only delete assigned conversations' });
            return;
        }
        await (0, resourceDelete_service_1.deleteConversationPermanently)(companyId, req.params.id);
        res.json({ message: 'Conversation deleted permanently' });
    }
    catch (err) {
        handleDeleteError(err, res);
    }
});
/**
 * POST /api/conversations/:id/messages
 * Agent sends a message (text/document/quick-reply) in a conversation.
 */
const sendConversationMessageHandler = async (req, res) => {
    try {
        const companyId = (0, tenant_1.getCompanyId)(req);
        const conversation = await prisma_1.default.conversation.findFirst({
            where: { id: req.params.id, companyId },
            include: { lead: true },
        });
        if (!conversation) {
            res.status(404).json({ error: 'Conversation not found' });
            return;
        }
        if (req.user.role === 'sales_agent' && conversation.lead?.assignedAgentId !== req.user.id) {
            res.status(403).json({ error: 'Can only send messages for assigned conversations' });
            return;
        }
        const parsed = validation_1.sendConversationMessageSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: 'Invalid message payload',
                details: parsed.error.flatten().fieldErrors,
            });
            return;
        }
        const company = await prisma_1.default.company.findUnique({
            where: { id: companyId },
            select: { settings: true, whatsappPhone: true },
        });
        if (!company) {
            res.status(404).json({ error: 'Company not found' });
            return;
        }
        const whatsappConfig = normalizeWhatsAppConfig(company);
        if (!whatsappConfig.phoneNumberId || !whatsappConfig.accessToken) {
            res.status(400).json({ error: 'WhatsApp is not configured for this company' });
            return;
        }
        const payload = parsed.data;
        let outboundSuccess = false;
        let outboundMessageId;
        let outboundError;
        if (payload.mode === 'text') {
            outboundSuccess = await whatsapp_service_1.whatsappService.sendMessage(conversation.whatsappPhone, payload.text, whatsappConfig);
        }
        else if (payload.mode === 'document') {
            const sendResult = await whatsapp_service_1.whatsappService.sendDocument(conversation.whatsappPhone, payload.document_url, payload.filename?.trim() || 'document.pdf', payload.caption?.trim() || null, whatsappConfig);
            outboundSuccess = sendResult.success;
            outboundMessageId = sendResult.messageId;
            outboundError = sendResult.error;
        }
        else {
            const quickReplyButtons = payload.buttons;
            const sendResult = await whatsapp_service_1.whatsappService.sendInteractiveButtons(conversation.whatsappPhone, payload.body_text, quickReplyButtons, payload.header_text?.trim() || null, payload.footer_text?.trim() || null, whatsappConfig);
            outboundSuccess = sendResult.success;
            outboundMessageId = sendResult.messageId;
            outboundError = sendResult.error;
        }
        if (!outboundSuccess) {
            res.status(502).json({ error: outboundError || 'Failed to send WhatsApp message' });
            return;
        }
        const msg = await prisma_1.default.message.create({
            data: {
                conversationId: conversation.id,
                senderType: 'agent',
                content: buildMessageContent(payload),
                whatsappMessageId: outboundMessageId,
                status: 'sent',
            },
        });
        const nextConversationStatus = conversation.status === 'ai_active' ? 'agent_active' : conversation.status;
        await prisma_1.default.conversation.update({
            where: { id: conversation.id },
            data: { status: nextConversationStatus },
        });
        const dto = mapMessageToDTO(msg);
        socket_service_1.socketService.emitToCompany(companyId, socket_service_1.SOCKET_EVENTS.MESSAGE_NEW, {
            conversationId: conversation.id,
            message: dto,
        });
        socket_service_1.socketService.emitToCompany(companyId, socket_service_1.SOCKET_EVENTS.CONVERSATION_UPDATED, {
            conversationId: conversation.id,
            leadId: conversation.leadId,
            trigger: 'agent_message_sent',
            occurredAt: new Date().toISOString(),
        });
        res.json({ data: dto, conversation_status: nextConversationStatus });
    }
    catch (err) {
        logger_1.default.error('Failed to send message', { error: err.message });
        res.status(500).json({ error: 'Failed to send message' });
    }
};
router.post('/:id/messages', (0, rbac_1.authorize)('conversations', 'read'), sendConversationMessageHandler);
// Backward-compatible alias for older clients.
router.post('/:id/message', (0, rbac_1.authorize)('conversations', 'read'), sendConversationMessageHandler);
exports.default = router;
