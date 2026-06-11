/**
 * Outbound turn tracing — MCP-debuggable structured log layer.
 *
 * Every call to logOutboundBranch, logOutboundSend, and claimPrimaryOutboundSend
 * emits a structured JSON log line at `debug` level. In production Railway logs
 * these appear under the `outbound_trace` event field, filterable with:
 *   railway logs | grep outbound_trace
 *
 * The module also enforces the one-primary-outbound-per-turn invariant via
 * claimPrimaryOutboundSend. No external HTTP call is made — all output goes
 * through the standard logger.
 */
import logger from '../config/logger';

export type OutboundTurnChannel = 'buyer' | 'staff' | 'system';

export interface OutboundTurnContext {
  channel: OutboundTurnChannel;
  inboundMessageId?: string | null;
  companyId?: string;
  route?: string;
  /** E.164 buyer phone — only outbound to this recipient counts against the one-reply budget. */
  customerPhone?: string | null;
  sendCount: number;
  primarySendCount: number;
  /** Staff bulk forward: track external recipients so each phone gets one send per turn. */
  staffRecipientTails?: Set<string>;
}

let activeTurn: OutboundTurnContext | null = null;

/**
 * Emits a structured debug log line for MCP / Railway log inspection.
 *
 * @param hypothesisId - Handler label (e.g. 'H2', 'H-start').
 * @param location - `filename:function` for stack traceability.
 * @param event - Short event name (snake_case).
 * @param data - Arbitrary context fields.
 */
function emit(
  hypothesisId: string,
  location: string,
  event: string,
  data: Record<string, unknown>,
): void {
  logger.debug('outbound_trace', {
    hypothesisId,
    location,
    event,
    ...data,
  });
}

/**
 * Starts a new turn context. Call once per inbound message before any handler runs.
 *
 * @param ctx - Turn identity fields (channel, companyId, messageId, phone, route).
 */
export function beginOutboundTurn(ctx: Omit<OutboundTurnContext, 'sendCount' | 'primarySendCount'>): void {
  activeTurn = { ...ctx, sendCount: 0, primarySendCount: 0 };
  emit('H0', 'outboundTurnDebug:beginOutboundTurn', 'inbound_turn_started', {
    channel: ctx.channel,
    inboundMessageId: ctx.inboundMessageId ?? null,
    companyId: ctx.companyId ?? null,
    route: ctx.route ?? null,
  });
}

/**
 * Logs which handler branch fired. Call at the top of each handler's happy-path.
 *
 * @param hypothesisId - Handler label per full.md cascade (H-start, H1, H2, …).
 * @param location - Source location string for grep.
 * @param branch - Snake-case branch name matching full.md routing table.
 * @param extra - Optional additional context fields.
 */
export function logOutboundBranch(
  hypothesisId: string,
  location: string,
  branch: string,
  extra: Record<string, unknown> = {},
): void {
  emit(hypothesisId, location, 'routing_branch', {
    branch,
    inboundMessageId: activeTurn?.inboundMessageId ?? null,
    channel: activeTurn?.channel ?? null,
    route: activeTurn?.route ?? null,
    sendCountSoFar: activeTurn?.sendCount ?? 0,
    ...extra,
  });
}

/**
 * Logs an outbound WhatsApp send and increments the turn send counter.
 *
 * @param hypothesisId - Handler label.
 * @param location - Source location string.
 * @param source - Descriptor of what generated this send (e.g. 'ai_reply', 'h2_rapport').
 * @param preview - First 100 chars of the outbound text (not logged in full to avoid PII risk).
 * @param extra - Optional additional context fields.
 */
export function logOutboundSend(
  hypothesisId: string,
  location: string,
  source: string,
  preview: string,
  extra: Record<string, unknown> = {},
): void {
  if (activeTurn) {
    activeTurn.sendCount += 1;
  }
  const sendIndex = activeTurn?.sendCount ?? 0;
  emit(hypothesisId, location, 'whatsapp_outbound_send', {
    source,
    sendIndex,
    preview: preview.slice(0, 100),
    inboundMessageId: activeTurn?.inboundMessageId ?? null,
    channel: activeTurn?.channel ?? null,
    route: activeTurn?.route ?? null,
    ...extra,
  });
}

/**
 * Ends the current turn and logs the final send counts.
 *
 * @param status - Outcome label (e.g. 'replied', 'skipped', 'error').
 */
export function endOutboundTurn(status: string): void {
  emit('END', 'outboundTurnDebug:endOutboundTurn', 'inbound_turn_finished', {
    status,
    totalSends: activeTurn?.sendCount ?? 0,
    primarySendCount: activeTurn?.primarySendCount ?? 0,
    inboundMessageId: activeTurn?.inboundMessageId ?? null,
    channel: activeTurn?.channel ?? null,
    route: activeTurn?.route ?? null,
  });
  activeTurn = null;
}

/**
 * Returns how many WhatsApp sends have occurred in the current turn.
 * Used by tests to assert the one-outbound invariant.
 *
 * @returns Current send count, 0 if no active turn.
 */
export function getActiveTurnSendCount(): number {
  return activeTurn?.sendCount ?? 0;
}

function normalizePhoneTail(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(-10);
}

/**
 * Enforces the one-primary-outbound-per-turn invariant.
 *
 * Returns false (and emits a log) if a primary send has already been claimed this turn
 * for the same recipient. Staff/system sends to different phones are never blocked.
 *
 * @param hypothesisId - Handler label requesting the send.
 * @param location - Source location string.
 * @param source - Descriptor of the caller.
 * @param recipient - Recipient E.164 phone (optional; if missing, block is skipped).
 * @returns true if the caller may proceed with the send; false if it must be suppressed.
 */
export function claimPrimaryOutboundSend(
  hypothesisId: string,
  location: string,
  source: string,
  recipient?: string | null,
  staffBulkRecipient = false,
): boolean {
  if (!activeTurn) return true;
  const buyerTail = normalizePhoneTail(activeTurn.customerPhone);
  const recipientTail = normalizePhoneTail(recipient);

  // Staff bulk forward: allow multiple distinct numbers in one copilot turn.
  // staffBulkRecipient=true also applies when channel was not set to staff (dashboard copilot).
  if (recipientTail && (activeTurn.channel === 'staff' || staffBulkRecipient)) {
    activeTurn.staffRecipientTails ??= new Set<string>();
    if (activeTurn.staffRecipientTails.has(recipientTail)) {
      emit(hypothesisId, location, 'primary_outbound_blocked', {
        source,
        reason: 'duplicate_staff_recipient',
        recipientTail,
        primarySendCount: activeTurn.primarySendCount,
        inboundMessageId: activeTurn.inboundMessageId ?? null,
      });
      return false;
    }
    activeTurn.staffRecipientTails.add(recipientTail);
    activeTurn.primarySendCount += 1;
    return true;
  }

  if (buyerTail && recipientTail && buyerTail !== recipientTail) return true;
  if (activeTurn.primarySendCount >= 1) {
    emit(hypothesisId, location, 'primary_outbound_blocked', {
      source,
      primarySendCount: activeTurn.primarySendCount,
      inboundMessageId: activeTurn.inboundMessageId ?? null,
    });
    return false;
  }
  activeTurn.primarySendCount += 1;
  return true;
}

/**
 * Releases a primary send claim when the interactive API call fails, allowing
 * the text fallback path to send instead.
 *
 * @param hypothesisId - Handler label releasing the claim.
 * @param location - Source location string.
 * @param source - Descriptor of the caller.
 */
export function releasePrimaryOutboundClaim(
  hypothesisId: string,
  location: string,
  source: string,
): void {
  if (!activeTurn || activeTurn.primarySendCount < 1) return;
  activeTurn.primarySendCount -= 1;
  emit(hypothesisId, location, 'primary_outbound_claim_released', {
    source,
    primarySendCount: activeTurn.primarySendCount,
    inboundMessageId: activeTurn.inboundMessageId ?? null,
  });
}
