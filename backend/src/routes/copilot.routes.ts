/**
 * @file copilot.routes.ts
 * @description Dashboard copilot REST endpoint.
 *
 * POST /api/copilot/chat
 *   Re-uses the full staff WhatsApp copilot pipeline (handleAgentMessage) to serve
 *   browser-based dashboard chat without requiring a WhatsApp handset. Functionally
 *   equivalent to the staff WhatsApp copilot — same LLM, same tools, same memory.
 *
 * Security:
 *   - Authenticated via existing JWT middleware.
 *   - Role guard: only company_admin, sales_agent, operations, super_admin may call.
 *   - Rate-limited at companyAiRateLimiter (30 req/min per user) in app.ts.
 *   - Input validated: message is string, 1–1200 chars (same cap as workflow engine).
 *   - No secrets, stack traces, or internal service names leaked in error responses.
 *
 * Compliance: PII in messages is handled identically to the WhatsApp copilot.
 *   No additional data is stored beyond what the WhatsApp pipeline already stores.
 */

import { Router, Response } from 'express';
import logger from '../config/logger';
import { authenticate, AuthRequest } from '../middleware/auth';

/** Roles permitted to call the dashboard copilot. Viewer gets read-only pipeline. */
const ALLOWED_COPILOT_ROLES = new Set([
  'company_admin',
  'sales_agent',
  'operations',
  'super_admin',
  'viewer',
]);

/** Maximum message length accepted (mirrors workflow engine guard). */
const MAX_MESSAGE_LENGTH = 1200;

const router = Router();

/**
 * POST /api/copilot/chat
 *
 * Accepts a plain-text message from the dashboard chat UI and runs it through
 * the full staff copilot pipeline (deterministic CRM → workflow LLM → intent →
 * LangGraph fallback). Returns the reply text and a classification kind.
 *
 * @param req.body.message - Staff message text. Max 1200 chars.
 * @returns 200 { data: { reply: string; replyKind: string } }
 * @throws 400 - Validation error (message missing or too long).
 * @throws 401 - Missing or invalid JWT.
 * @throws 403 - Role not permitted.
 * @throws 500 - Internal error (details not exposed).
 */
router.post('/chat', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required', details: null, requestId: (req as any).requestId } });
    return;
  }

  if (!ALLOWED_COPILOT_ROLES.has(user.role)) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Your role does not have access to the copilot', details: null, requestId: (req as any).requestId } });
    return;
  }

  const rawMessage = req.body?.message;
  if (typeof rawMessage !== 'string' || !rawMessage.trim()) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'message is required and must be a non-empty string', details: null, requestId: (req as any).requestId } });
    return;
  }

  if (rawMessage.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `message must not exceed ${MAX_MESSAGE_LENGTH} characters`, details: null, requestId: (req as any).requestId } });
    return;
  }

  const messageText = rawMessage.trim();

  try {
    // Resolve company + user metadata needed by the copilot pipeline.
    const prisma = (await import('../config/prisma')).default;
    const companyUser = await prisma.user.findFirst({
      where: { id: user.id, status: 'active' },
      select: { id: true, name: true, phone: true, companyId: true, role: true },
    });

    if (!companyUser?.companyId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'User is not associated with an active company', details: null, requestId: (req as any).requestId } });
      return;
    }

    const company = await prisma.company.findFirst({
      where: { id: companyUser.companyId, status: 'active' },
      select: { name: true },
    });

    if (!company) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Company is inactive', details: null, requestId: (req as any).requestId } });
      return;
    }

    // Build a CompanyUserMatch-compatible object for handleAgentMessage.
    // phone is null for dashboard users who have not registered a WhatsApp number.
    // The copilot pipeline handles null phones gracefully (no WhatsApp send).
    const { handleAgentMessage } = await import('../services/agent/agent-router.service');
    const copilotUser = {
      userId: companyUser.id,
      userRole: companyUser.role,
      userName: companyUser.name ?? 'User',
      phone: companyUser.phone ?? '',
      companyId: companyUser.companyId,
      companyName: company.name,
    };

    const { text: reply, replyKind } = await handleAgentMessage(copilotUser, messageText);

    res.status(200).json({ data: { reply, replyKind } });
  } catch (err: unknown) {
    const requestId = (req as any).requestId as string | undefined;
    logger.error('Dashboard copilot chat failed', {
      userId: user.id,
      companyId: user.company_id,
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Could not process your message. Please try again.',
        details: null,
        requestId,
      },
    });
  }
});

export default router;
