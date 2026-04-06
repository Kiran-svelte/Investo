import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import { requireFeature } from '../middleware/featureGate';
import { isValidTransition, CONVERSATION_TRANSITIONS, ConversationStatus } from '../models/validation';
import prisma from '../config/prisma';
import logger from '../config/logger';

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);
router.use(requireFeature('conversation_center'));

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

      const enriched = conversations.map(({ lead, ...c }) => ({
        ...c,
        customer_name: lead?.customerName || null,
        customer_phone: lead?.phone || null,
        assigned_agent_id: lead?.assignedAgentId || null,
        last_message: lastMsgMap.get(c.id) || null,
      }));

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

      const { lead, ...convData } = conversation;
      res.json({
        data: {
          ...convData,
          customer_name: lead?.customerName || null,
          customer_phone: lead?.phone || null,
          assigned_agent_id: lead?.assignedAgentId || null,
          messages,
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
 * POST /api/conversations/:id/message
 * Agent sends a message in a conversation.
 */
router.post(
  '/:id/message',
  authorize('conversations', 'read'),
  async (req: AuthRequest, res: Response) => {
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

      const { message } = req.body;
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'message is required' });
        return;
      }

      // Store the agent's message
      const msg = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: 'agent',
          content: message,
          status: 'sent',
        },
      });

      // If conversation was AI active, auto-takeover
      if (conversation.status === 'ai_active') {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { status: 'agent_active' },
        });
      }

      res.json({ data: msg });
    } catch (err: any) {
      logger.error('Failed to send message', { error: err.message });
      res.status(500).json({ error: 'Failed to send message' });
    }
  }
);

export default router;
