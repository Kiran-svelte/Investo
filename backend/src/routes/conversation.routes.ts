import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import { requireFeature } from '../middleware/featureGate';
import { sendConversationMessageSchema } from '../models/validation';
import prisma from '../config/prisma';
import logger from '../config/logger';
import config from '../config';
import { whatsappService } from '../services/whatsapp.service';
import { socketService, SOCKET_EVENTS } from '../services/socket.service';

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);
router.use(requireFeature('conversation_center'));

function normalizeWhatsAppConfig(company: { settings: unknown; whatsappPhone: string | null }) {
  const settings = (company.settings as any) || {};
  return {
    phoneNumberId: settings.whatsapp?.phoneNumberId || company.whatsappPhone || config.whatsapp.phoneNumberId,
    accessToken: settings.whatsapp?.accessToken || config.whatsapp.accessToken,
    verifyToken: settings.whatsapp?.verifyToken || config.whatsapp.verifyToken,
  };
}

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function mapMessageToDTO(msg: any) {
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

function mapConversationToSnakeCaseDTO(conv: any, options?: { lastMessage?: any | null }) {
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

function buildMessageContent(payload: any): string {
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

  const buttonTitles = payload.buttons.map((button: { title: string }) => button.title).join(' | ');
  return `${payload.body_text}\n\n[Quick Replies] ${buttonTitles}`;
}

/**
 * GET /api/conversations
 * List conversations. Sales agents see only their leads' conversations.
 */
router.get(
  '/',
  authorize('conversations', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const where: any = { companyId };

      if (req.user!.role === 'sales_agent') {
        where.lead = { assignedAgentId: req.user!.id };
      }

      const { status, search } = req.query;
      if (status) where.status = status as string;
      if (search) {
        const searchCondition = {
          OR: [
            { customerName: { contains: search as string, mode: 'insensitive' as const } },
            { phone: { contains: search as string, mode: 'insensitive' as const } },
          ],
        };
        if (where.lead) {
          where.lead = { ...where.lead, ...searchCondition };
        } else {
          where.lead = searchCondition;
        }
      }

      const conversations = await prisma.conversation.findMany({
        where,
        include: {
          lead: { select: { customerName: true, phone: true, assignedAgentId: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });

      // Get last message for each conversation
      const convIds = conversations.map((c) => c.id);
      const lastMessages = convIds.length > 0
        ? (await Promise.all(
            convIds.map((convId) =>
              prisma.message.findFirst({
                where: { conversationId: convId },
                orderBy: { createdAt: 'desc' },
              })
            )
          )).filter(Boolean)
        : [];

      const lastMsgMap = new Map(lastMessages.map((m: any) => [m.conversationId, m]));

      const enriched = conversations.map((conv: any) =>
        mapConversationToSnakeCaseDTO(conv, { lastMessage: lastMsgMap.get(conv.id) || null })
      );

      res.json({ data: enriched, total: enriched.length });
    } catch (err: any) {
      logger.error('Failed to fetch conversations', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  }
);

/**
 * GET /api/conversations/:id
 * Get conversation with full message history.
 */
router.get(
  '/:id',
  authorize('conversations', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const conversation = await prisma.conversation.findFirst({
        where: { id: req.params.id, companyId },
        include: {
          lead: { select: { customerName: true, phone: true, assignedAgentId: true } },
        },
      });

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      if (req.user!.role === 'sales_agent' && conversation.lead?.assignedAgentId !== req.user!.id) {
        res.status(403).json({ error: 'Can only view assigned conversations' });
        return;
      }

      // Get all messages
      const messages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
      });

      const dto = mapConversationToSnakeCaseDTO(conversation);
      res.json({
        data: {
          ...dto,
          messages: messages.map((msg: any) => mapMessageToDTO(msg)),
        },
      });
    } catch (err: any) {
      logger.error('Failed to fetch conversation', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch conversation' });
    }
  }
);

/**
 * PATCH /api/conversations/:id/takeover
 * Agent takes over conversation from AI.
 */
router.patch(
  '/:id/takeover',
  authorize('conversations', 'read'),
  auditLog('takeover', 'conversations'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const conversation = await prisma.conversation.findFirst({
        where: { id: req.params.id, companyId },
      });

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      if (conversation.status !== 'ai_active') {
        res.status(400).json({ error: 'Can only take over AI-active conversations' });
        return;
      }

      await prisma.conversation.update({
        where: { id: req.params.id },
        data: { status: 'agent_active' },
      });

      res.json({ message: 'Agent takeover successful', data: { status: 'agent_active' } });
    } catch (err: any) {
      logger.error('Failed to takeover conversation', { error: err.message });
      res.status(500).json({ error: 'Failed to takeover conversation' });
    }
  }
);

/**
 * PATCH /api/conversations/:id/release
 * Agent releases conversation back to AI.
 */
router.patch(
  '/:id/release',
  authorize('conversations', 'read'),
  auditLog('release', 'conversations'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const conversation = await prisma.conversation.findFirst({
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

      await prisma.conversation.update({
        where: { id: req.params.id },
        data: { status: 'ai_active' },
      });

      res.json({ message: 'Released to AI', data: { status: 'ai_active' } });
    } catch (err: any) {
      logger.error('Failed to release conversation', { error: err.message });
      res.status(500).json({ error: 'Failed to release conversation' });
    }
  }
);

/**
 * PATCH /api/conversations/:id/close
 * Close a conversation.
 */
router.patch(
  '/:id/close',
  authorize('conversations', 'read'),
  auditLog('close', 'conversations'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const conversation = await prisma.conversation.findFirst({
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

      await prisma.conversation.update({
        where: { id: req.params.id },
        data: { status: 'closed' },
      });

      res.json({ message: 'Conversation closed' });
    } catch (err: any) {
      logger.error('Failed to close conversation', { error: err.message });
      res.status(500).json({ error: 'Failed to close conversation' });
    }
  }
);

/**
 * POST /api/conversations/:id/messages
 * Agent sends a message (text/document/quick-reply) in a conversation.
 */
const sendConversationMessageHandler = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const conversation = await prisma.conversation.findFirst({
      where: { id: req.params.id, companyId },
      include: { lead: true },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    if (req.user!.role === 'sales_agent' && conversation.lead?.assignedAgentId !== req.user!.id) {
      res.status(403).json({ error: 'Can only send messages for assigned conversations' });
      return;
    }

    const parsed = sendConversationMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid message payload',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const company = await prisma.company.findUnique({
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
    let outboundMessageId: string | undefined;
    let outboundError: string | undefined;

    if (payload.mode === 'text') {
      outboundSuccess = await whatsappService.sendMessage(
        conversation.whatsappPhone,
        payload.text,
        whatsappConfig
      );
    } else if (payload.mode === 'document') {
      const sendResult = await whatsappService.sendDocument(
        conversation.whatsappPhone,
        payload.document_url,
        payload.filename?.trim() || 'document.pdf',
        payload.caption?.trim() || null,
        whatsappConfig
      );
      outboundSuccess = sendResult.success;
      outboundMessageId = sendResult.messageId;
      outboundError = sendResult.error;
    } else {
      const quickReplyButtons = payload.buttons as Array<{ id: string; title: string }>;
      const sendResult = await whatsappService.sendInteractiveButtons(
        conversation.whatsappPhone,
        payload.body_text,
        quickReplyButtons,
        payload.header_text?.trim() || null,
        payload.footer_text?.trim() || null,
        whatsappConfig
      );
      outboundSuccess = sendResult.success;
      outboundMessageId = sendResult.messageId;
      outboundError = sendResult.error;
    }

    if (!outboundSuccess) {
      res.status(502).json({ error: outboundError || 'Failed to send WhatsApp message' });
      return;
    }

    const msg = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: 'agent',
        content: buildMessageContent(payload),
        whatsappMessageId: outboundMessageId,
        status: 'sent',
      },
    });

    const nextConversationStatus = conversation.status === 'ai_active' ? 'agent_active' : conversation.status;

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: nextConversationStatus },
    });

    const dto = mapMessageToDTO(msg);
    socketService.emitToCompany(companyId, SOCKET_EVENTS.MESSAGE_NEW, {
      conversationId: conversation.id,
      message: dto,
    });
    socketService.emitToCompany(companyId, SOCKET_EVENTS.CONVERSATION_UPDATED, {
      conversationId: conversation.id,
      leadId: conversation.leadId,
      trigger: 'agent_message_sent',
      occurredAt: new Date().toISOString(),
    });

    res.json({ data: dto, conversation_status: nextConversationStatus });
  } catch (err: any) {
    logger.error('Failed to send message', { error: err.message });
    res.status(500).json({ error: 'Failed to send message' });
  }
};

router.post(
  '/:id/messages',
  authorize('conversations', 'read'),
  sendConversationMessageHandler
);

// Backward-compatible alias for older clients.
router.post(
  '/:id/message',
  authorize('conversations', 'read'),
  sendConversationMessageHandler
);

export default router;
