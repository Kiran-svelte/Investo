/**
 * Debug-only outbound turn tracing (session 00edec).
 * Tracks how many WhatsApp sends fire per inbound message.
 */

const DEBUG_ENDPOINT = 'http://127.0.0.1:7737/ingest/e570e274-2b9f-4460-95d9-ffd83c68631e';
const DEBUG_SESSION = '44596a';

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
}

let activeTurn: OutboundTurnContext | null = null;

function emit(
  _hypothesisId: string,
  _location: string,
  _message: string,
  _data: Record<string, unknown>,
): void {
  // Debug ingest disabled — claimPrimaryOutboundSend / turn budget remain active.
}

export function beginOutboundTurn(ctx: Omit<OutboundTurnContext, 'sendCount' | 'primarySendCount'>): void {
  activeTurn = { ...ctx, sendCount: 0, primarySendCount: 0 };
  emit('H2', 'outboundTurnDebug.service.ts:beginOutboundTurn', 'inbound_turn_started', {
    channel: ctx.channel,
    inboundMessageId: ctx.inboundMessageId ?? null,
    companyId: ctx.companyId ?? null,
    route: ctx.route ?? null,
  });
}

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

export function endOutboundTurn(status: string): void {
  emit('H1', 'outboundTurnDebug.service.ts:endOutboundTurn', 'inbound_turn_finished', {
    status,
    totalSends: activeTurn?.sendCount ?? 0,
    primarySendCount: activeTurn?.primarySendCount ?? 0,
    inboundMessageId: activeTurn?.inboundMessageId ?? null,
    channel: activeTurn?.channel ?? null,
    route: activeTurn?.route ?? null,
  });
  activeTurn = null;
}

export function getActiveTurnSendCount(): number {
  return activeTurn?.sendCount ?? 0;
}

function normalizePhoneTail(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(-10);
}

/** At most one primary text/interactive bubble per inbound turn (media addon is separate). */
export function claimPrimaryOutboundSend(
  hypothesisId: string,
  location: string,
  source: string,
  recipient?: string | null,
): boolean {
  if (!activeTurn) return true;
  const buyerTail = normalizePhoneTail(activeTurn.customerPhone);
  const recipientTail = normalizePhoneTail(recipient);
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

/** Release a primary claim when interactive API fails so text fallback can send. */
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
