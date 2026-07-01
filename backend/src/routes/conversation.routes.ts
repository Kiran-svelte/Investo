import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { strictTenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import { requireFeature } from '../middleware/featureGate';
import { propertyCompletenessGate } from '../middleware/propertyCompletenessGate';
import { sendConversationMessageSchema } from '../models/validation';
import prisma from '../config/prisma';
import logger from '../config/logger';
import config from '../config';
import { whatsappService } from '../services/whatsapp.service';
import { socketService, SOCKET_EVENTS } from '../services/socket.service';
import { buildPaginationMeta, parsePagination } from '../utils/pagination';
import {
  deleteConversationPermanently,
  ResourceDeleteError,
} from '../services/resourceDelete.service';
import { resolveCompanyWhatsAppConfigFromSettings } from '../utils/companyWhatsAppConfig.util';
import {
  resolveAgentUserIdsForBranch,
  resolveEffectiveBranchId,
  isOrgBranchesEnabled,
} from '../identity/org/branchScope.service';

const EMPTY_AGENT_SENTINEL = '00000000-0000-0000-0000-000000000000';

async function applyConversationBranchScope(
  where: Record<string, any>,
  companyId: string,
  user: AuthRequest['user'],
  query: Record<string, unknown>,
): Promise<void> {
  if (!user || !isOrgBranchesEnabled() || user.role === 'sales_agent') {
    return;
  }
  const branchId = resolveEffectiveBranchId(
    { role: user.role, branch_id: user.branch_id },
    typeof query.branch_id === 'string' ? query.branch_id : null,
  );
  if (!branchId) {
    return;
  }
  const agentIds = await resolveAgentUserIdsForBranch(companyId, branchId);
  const scope = {
    assignedAgentId: { in: agentIds.length > 0 ? agentIds : [EMPTY_AGENT_SENTINEL] },
  };
  where.lead = where.lead ? { ...where.lead, ...scope } : scope;
}

function handleDeleteError(err: unknown, res: Response): void {
  if (err instanceof ResourceDeleteError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Delete failed';
  logger.error('Delete failed', { error: message });
  res.status(500).json({ error: message });
}

const router = Router();

router.use(authenticate);
router.use(strictTenantIsolation);
router.use(propertyCompletenessGate);
router.use(requireFeature('conversation_center'));

function normalizeWhatsAppConfig(company: { settings: unknown; whatsappPhone: string | null }) {
  return resolveCompanyWhatsAppConfigFromSettings(company.settings) ?? {
    provider: 'meta' as const,
    phoneNumberId: '',
    accessToken: '',
    verifyToken: '',
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
    delivery_status: msg.deliveryStatus || null,
    meta_message_id: msg.metaMessageId || null,
    failed_reason: msg.failedReason || null,
    status: msg.status,
    // INVESTO-FIX-2026-07-01: surface media fields to the frontend so images/documents/video/audio render properly
    message_type: msg.messageType || 'text',
    media_url: msg.mediaUrl || null,
    mime_type: msg.mimeType || null,
    media_caption: msg.mediaCaption || null,
    created_at: msg.createdAt?.toISOString?.() || msg.createdAt,
  };
}

function mapConversationToSnakeCaseDTO(conv: any, options?: { lastMessage?: any | null }) {
  /**
   * is_taken_over: true when a human agent has paused the AI and is replying
   * directly. Derived from status='agent_active' so the frontend never needs
   * a separate field to show the takeover banner.
   */
  const isTakenOver = conv.status === 'agent_active';

  return {
    id: conv.id,
    company_id: conv.companyId,
    lead_id: conv.leadId,
    whatsapp_phone: conv.whatsappPhone,
    status: conv.status,
    language: conv.language,
    ai_enabled: conv.aiEnabled,
    // Chunk-02: explicit takeover state for frontend banner / thread header.
    is_taken_over: isTakenOver,
    taken_over_by_agent_id: isTakenOver ? (conv.lead?.assignedAgentId ?? null) : null,
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
    // INVESTO-FIX-2026-07-01: content is now a short fallback only; the raw URL lives in mediaUrl instead
    const fileName = payload.filename?.trim() || 'document.pdf';
    return `[Document] ${fileName}`;
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

      await applyConversationBranchScope(where, companyId, req.user, req.query as Record<string, unknown>);

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

      const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);

      const [conversations, total] = await Promise.all([
        prisma.conversation.findMany({
          where,
          include: {
            lead: { select: { customerName: true, phone: true, assignedAgentId: true } },
          },
          orderBy: { updatedAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        prisma.conversation.count({ where }),
      ]);

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

      res.json({
        data: enriched,
        pagination: buildPaginationMeta(page, limit, total),
      });
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

      // Paginated messages (default chronological page 1 = oldest chunk; use sort=desc for latest-first)
      const sortDesc = req.query.sort === 'desc';
      const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>, {
        limit: 50,
        maxLimit: 100,
      });

      const [messages, messageTotal] = await Promise.all([
        prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: sortDesc ? 'desc' : 'asc' },
          skip: offset,
          take: limit,
        }),
        prisma.message.count({ where: { conversationId: conversation.id } }),
      ]);

      const orderedMessages = sortDesc ? [...messages].reverse() : messages;

      const dto = mapConversationToSnakeCaseDTO(conversation);
      res.json({
        data: {
          ...dto,
          messages: orderedMessages.map((msg: any) => mapMessageToDTO(msg)),
        },
        pagination: buildPaginationMeta(page, limit, messageTotal),
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
 * Requires 'update' permission — 'read' alone is insufficient to change conversation ownership.
 */
router.patch(
  '/:id/takeover',
  authorize('conversations', 'update'),
  auditLog('takeover', 'conversations'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const conversation = await prisma.conversation.findFirst({
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
      if (
        req.user!.role === 'sales_agent' &&
        conversation.lead?.assignedAgentId !== req.user!.id
      ) {
        res.status(403).json({ error: 'Can only take over conversations assigned to you' });
        return;
      }

      await prisma.conversation.update({
        where: { id: req.params.id },
        data: { status: 'agent_active', aiEnabled: false },
      });

      socketService.emitToCompany(companyId, SOCKET_EVENTS.CONVERSATION_UPDATED, {
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
    } catch (err: any) {
      logger.error('Failed to takeover conversation', { error: err.message });
      res.status(500).json({ error: 'Failed to takeover conversation' });
    }
  }
);

/**
 * PATCH /api/conversations/:id/release
 * Agent releases conversation back to AI.
 * Requires 'update' permission — 'read' alone is insufficient to change conversation ownership.
 */
router.patch(
  '/:id/release',
  authorize('conversations', 'update'),
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
        data: {
          status: 'ai_active',
          aiEnabled: true,
          ...(conversation.stage === 'human_escalated' && {
            stage: 'qualify',
            escalationReason: null,
          }),
        },
      });

      socketService.emitToCompany(companyId, SOCKET_EVENTS.CONVERSATION_UPDATED, {
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
    } catch (err: any) {
      logger.error('Failed to release conversation', { error: err.message });
      res.status(500).json({ error: 'Failed to release conversation' });
    }
  }
);

/**
 * PATCH /api/conversations/:id/close
 * Close a conversation.
 * Requires 'update' permission — closing changes conversation status permanently.
 */
router.patch(
  '/:id/close',
  authorize('conversations', 'update'),
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
 * DELETE /api/conversations/:id
 * Permanently delete a conversation and all messages.
 */
router.delete(
  '/:id',
  authorize('conversations', 'delete'),
  auditLog('delete', 'conversations'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const conversation = await prisma.conversation.findFirst({
        where: { id: req.params.id, companyId },
        include: { lead: { select: { assignedAgentId: true } } },
      });

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      if (
        req.user!.role === 'sales_agent' &&
        conversation.lead?.assignedAgentId !== req.user!.id
      ) {
        res.status(403).json({ error: 'Can only delete assigned conversations' });
        return;
      }

      await deleteConversationPermanently(companyId, req.params.id);
      res.json({ message: 'Conversation deleted permanently' });
    } catch (err: unknown) {
      handleDeleteError(err, res);
    }
  },
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
    res.status(502).json({
      error: outboundError || 'Failed to send WhatsApp message',
      whatsapp_delivery_failed: true,
    });
      return;
    }

    // INVESTO-FIX-2026-07-01: populate messageType/mediaUrl/mimeType/mediaCaption for media/interactive sends
    const mediaFields: {
      messageType?: string;
      mediaUrl?: string;
      mimeType?: string;
      mediaCaption?: string;
    } = {};
    if (payload.mode === 'document') {
      mediaFields.messageType = 'document';
      mediaFields.mediaUrl = payload.document_url;
      if (payload.caption?.trim()) {
        mediaFields.mediaCaption = payload.caption.trim();
      }
    } else if (payload.mode === 'quick_reply') {
      mediaFields.messageType = 'interactive';
    }

    const msg = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: 'agent',
        content: buildMessageContent(payload),
        whatsappMessageId: outboundMessageId,
        status: 'sent',
        ...mediaFields,
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
  authorize('conversations', 'update'),
  sendConversationMessageHandler
);

// Backward-compatible alias for older clients.
router.post(
  '/:id/message',
  authorize('conversations', 'update'),
  sendConversationMessageHandler
);

export default router;
