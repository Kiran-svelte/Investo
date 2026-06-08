/**
 * Buyer inbound guard pipeline (full.md PART I §I.2–I.6).
 * Called from whatsapp.service.ts before lead/conversation bootstrap.
 *
 * Order: dedup → staff approval → staff route → fingerprint → concurrent lock+queue
 */
import logger from '../../config/logger';
import { maskPhoneNumberForLogs } from '../../utils/maskPhoneNumberForLogs';
import { normalizeInboundWhatsAppPhone } from '../../utils/phoneMatch';
import {
  claimCustomerInboundFingerprint,
  claimCustomerProcessingTurn,
  claimInboundMessageFull,
} from '../inboundMessageGuard.service';
import { routeCompanyScopedInbound } from '../inboundWhatsAppRouting.service';
import { logAgentAction } from '../agent-action-log.service';
import { logOutboundBranch } from '../outboundTurnDebug.service';
import { enqueueCustomerInbound } from '../customerInboundQueue.service';

/** Skip reasons aligned with full.md PART I / PART XVII. */
export type InboundGuardSkipReason =
  | 'duplicate_message_id'
  | 'visit_approval_handled'
  | 'call_approval_handled'
  | 'handled_by_agent_copilot'
  | 'handled_as_company_staff'
  | 'duplicate_customer_fingerprint'
  | 'concurrent_customer_processing';

export type GuardInboundMessage = {
  phoneNumberId: string;
  customerPhone: string;
  customerName: string;
  messageText: string;
  messageId: string;
  companyIdHint?: string;
  interactiveId?: string;
  interactiveType?: 'button_reply' | 'list_reply';
  businessDisplayPhone?: string;
  queuedReplay?: boolean;
};

export type InboundPropagationResult = {
  status: 'success' | 'failed' | 'not_attempted';
  reason?: string;
};

export type InboundGuardTerminalResult = {
  status: 'processed' | 'skipped' | 'failed';
  reason?: string;
  companyId?: string;
  leadId?: string;
  conversationId?: string;
  propagation: InboundPropagationResult;
};

export type InboundProspectGuardInput = {
  msg: GuardInboundMessage;
  companyId: string;
  customerPhone: string;
  notAttempted: InboundPropagationResult;
};

export type InboundProspectGuardResult =
  | { action: 'proceed'; claimedCustomerProcessingTurn: boolean }
  | { action: 'skip'; result: InboundGuardTerminalResult };

export function logInboundSkipped(
  reason: InboundGuardSkipReason | 'company_not_found',
  details: { companyId?: string; messageId?: string; customerPhone?: string },
): void {
  logger.info('Inbound skipped', {
    reason,
    companyId: details.companyId,
    messageId: details.messageId,
    customerPhone: details.customerPhone
      ? maskPhoneNumberForLogs(details.customerPhone)
      : undefined,
  });
}

function isStaffApprovalInteractive(interactiveId: string | undefined): boolean {
  if (!interactiveId?.trim()) return false;
  return (
    interactiveId.startsWith('visit-approve-') ||
    interactiveId.startsWith('visit-decline-') ||
    interactiveId.startsWith('call-approve-') ||
    interactiveId.startsWith('call-decline-')
  );
}

async function handleStaffApprovalIntercept(
  msg: GuardInboundMessage,
  companyId: string,
  customerPhone: string,
  notAttempted: InboundPropagationResult,
): Promise<InboundGuardTerminalResult | null> {
  if (!isStaffApprovalInteractive(msg.interactiveId)) return null;

  const { findCompanyUserByPhone } = await import('../inboundWhatsAppRouting.service');
  const companyUser = await findCompanyUserByPhone(customerPhone, companyId);

  if (!companyUser) {
    logger.warn('Staff approval interactive from non-staff phone — falling through to prospect pipeline', {
      companyId,
      interactiveId: msg.interactiveId,
      customerPhone: maskPhoneNumberForLogs(customerPhone),
    });
    return null;
  }

  if (
    msg.interactiveId!.startsWith('visit-approve-') ||
    msg.interactiveId!.startsWith('visit-decline-')
  ) {
    const { tryHandleVisitApprovalInteractive } = await import('../visitPendingApproval.service');
    const handled = await tryHandleVisitApprovalInteractive(msg.interactiveId!, {
      userId: companyUser.userId,
      companyId: companyUser.companyId,
      phone: companyUser.phone,
    });
    if (handled) {
      void logAgentAction({
        companyId,
        triggeredBy: 'inbound_message',
        action: 'visitApprovalInteractive',
        actorId: companyUser.userId,
        resourceType: 'visit',
        status: 'success',
        inputs: { interactiveId: msg.interactiveId },
      });
      return {
        status: 'processed',
        reason: 'visit_approval_handled',
        companyId,
        propagation: notAttempted,
      };
    }
    return null;
  }

  const { tryHandleCallApprovalInteractive } = await import('../callRequest.service');
  const handled = await tryHandleCallApprovalInteractive(msg.interactiveId!, {
    userId: companyUser.userId,
    companyId: companyUser.companyId,
    phone: companyUser.phone,
  });
  if (handled) {
    void logAgentAction({
      companyId,
      triggeredBy: 'inbound_message',
      action: 'callApprovalInteractive',
      actorId: companyUser.userId,
      resourceType: 'call_request',
      status: 'success',
      inputs: { interactiveId: msg.interactiveId },
    });
    return {
      status: 'processed',
      reason: 'call_approval_handled',
      companyId,
      propagation: notAttempted,
    };
  }

  return null;
}

async function enqueueConcurrentInboundRetry(
  companyId: string,
  customerPhone: string,
  msg: GuardInboundMessage,
): Promise<void> {
  if (!msg.messageId) return;

  try {
    await enqueueCustomerInbound(companyId, customerPhone, {
      phoneNumberId: msg.phoneNumberId,
      customerPhone: msg.customerPhone,
      customerName: msg.customerName,
      messageText: msg.messageText,
      messageId: msg.messageId,
      companyIdHint: msg.companyIdHint,
      interactiveId: msg.interactiveId,
      interactiveType: msg.interactiveType,
      businessDisplayPhone: msg.businessDisplayPhone,
    });
  } catch (queueErr: unknown) {
    logger.warn('Failed to enqueue concurrent inbound — scheduling short retry', {
      companyId,
      messageId: msg.messageId,
      error: queueErr instanceof Error ? queueErr.message : String(queueErr),
    });
    try {
      const { automationQueueService } = await import('../automationQueue.service');
      await automationQueueService.schedule(
        'retry_concurrent_inbound',
        `concurrent:${companyId}:${msg.messageId}`,
        new Date(Date.now() + 4_000),
        {
          companyId,
          phoneNumberId: msg.phoneNumberId,
          customerPhone: msg.customerPhone,
          customerName: msg.customerName,
          messageText: msg.messageText,
          messageId: msg.messageId,
          interactiveId: msg.interactiveId,
          interactiveType: msg.interactiveType,
          businessDisplayPhone: msg.businessDisplayPhone,
          queuedReplay: true,
        },
      );
    } catch (retryErr: unknown) {
      logger.warn('Failed to schedule short concurrent inbound retry', {
        companyId,
        messageId: msg.messageId,
        error: retryErr instanceof Error ? retryErr.message : String(retryErr),
      });
    }
  }
}

/**
 * Runs PART I guard layers after company resolution.
 * Returns `proceed` when the prospect pipeline should continue, or `skip` with a terminal result.
 */
export async function runInboundProspectGuards(
  input: InboundProspectGuardInput,
): Promise<InboundProspectGuardResult> {
  const { msg, companyId, notAttempted } = input;
  const customerPhone = normalizeInboundWhatsAppPhone(input.customerPhone);

  // Layer 1 — messageId dedup (skip re-claim on FIFO replay)
  if (msg.messageId && !msg.queuedReplay) {
    const inboundClaimed = await claimInboundMessageFull(
      companyId,
      msg.messageId,
      customerPhone,
    );
    if (!inboundClaimed) {
      logInboundSkipped('duplicate_message_id', {
        companyId,
        messageId: msg.messageId,
        customerPhone,
      });
      return {
        action: 'skip',
        result: {
          status: 'skipped',
          reason: 'duplicate_message_id',
          companyId,
          propagation: notAttempted,
        },
      };
    }
  }

  // Layer 2 — staff approval interactive intercept
  const approvalResult = await handleStaffApprovalIntercept(
    msg,
    companyId,
    customerPhone,
    notAttempted,
  );
  if (approvalResult) {
    return { action: 'skip', result: approvalResult };
  }

  // Layer 3 — staff copilot route (never prospect AI for staff phones)
  const staffRoute = await routeCompanyScopedInbound({
    senderPhone: customerPhone,
    messageText: msg.messageText,
    companyId,
    interactiveId: msg.interactiveId,
    inboundMessageId: msg.messageId,
  });
  if (staffRoute.handled) {
    logOutboundBranch('H2', 'whatsapp.service.ts:staffRoute', 'staff_route_handled', {
      routeKind: staffRoute.route.kind,
      companyId,
    });
    const reason =
      staffRoute.route.kind === 'agent_copilot'
        ? 'handled_by_agent_copilot'
        : 'handled_as_company_staff';
    logInboundSkipped(
      staffRoute.route.kind === 'agent_copilot'
        ? 'handled_by_agent_copilot'
        : 'handled_as_company_staff',
      { companyId, messageId: msg.messageId },
    );
    return {
      action: 'skip',
      result: {
        status: 'processed',
        reason,
        companyId,
        propagation: notAttempted,
      },
    };
  }

  // Layer 4 — text fingerprint dedup (not for interactive taps or queue replay)
  if (!msg.queuedReplay && !msg.interactiveId?.trim()) {
    const fingerprintClaimed = await claimCustomerInboundFingerprint(
      companyId,
      customerPhone,
      msg.messageText,
    );
    if (!fingerprintClaimed) {
      logInboundSkipped('duplicate_customer_fingerprint', {
        companyId,
        messageId: msg.messageId,
        customerPhone,
      });
      return {
        action: 'skip',
        result: {
          status: 'skipped',
          reason: 'duplicate_customer_fingerprint',
          companyId,
          propagation: notAttempted,
        },
      };
    }
  }

  // Layer 5 — concurrent processing lock (interactive bypasses lock)
  const isInteractiveTap = Boolean(msg.interactiveId?.trim());
  let claimedCustomerProcessingTurn = false;
  const customerTurnClaimed = isInteractiveTap
    ? true
    : await claimCustomerProcessingTurn(companyId, customerPhone);

  if (!isInteractiveTap && customerTurnClaimed) {
    claimedCustomerProcessingTurn = true;
  }

  if (!customerTurnClaimed) {
    logOutboundBranch('H2', 'whatsapp.service.ts:concurrent', 'concurrent_customer_blocked', {
      companyId,
      inboundTraceId: msg.messageId ? msg.messageId.slice(-8) : undefined,
    });
    await enqueueConcurrentInboundRetry(companyId, customerPhone, msg);
    logInboundSkipped('concurrent_customer_processing', {
      companyId,
      messageId: msg.messageId,
      customerPhone,
    });
    return {
      action: 'skip',
      result: {
        status: 'skipped',
        reason: 'concurrent_customer_processing',
        companyId,
        propagation: notAttempted,
      },
    };
  }

  return { action: 'proceed', claimedCustomerProcessingTurn };
}
