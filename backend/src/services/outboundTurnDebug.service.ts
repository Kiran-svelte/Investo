/**
 * Debug-only outbound turn tracing (session 00edec).
 * Tracks how many WhatsApp sends fire per inbound message.
 */

const DEBUG_ENDPOINT = 'http://127.0.0.1:7737/ingest/e570e274-2b9f-4460-95d9-ffd83c68631e';
const DEBUG_SESSION = '00edec';

export type OutboundTurnChannel = 'buyer' | 'staff' | 'system';

export interface OutboundTurnContext {
  channel: OutboundTurnChannel;
  inboundMessageId?: string | null;
  companyId?: string;
  route?: string;
  sendCount: number;
}

let activeTurn: OutboundTurnContext | null = null;

function emit(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  // #region agent log
  fetch(DEBUG_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': DEBUG_SESSION,
    },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => undefined);
  // #endregion
}

export function beginOutboundTurn(ctx: Omit<OutboundTurnContext, 'sendCount'>): void {
  activeTurn = { ...ctx, sendCount: 0 };
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
    inboundMessageId: activeTurn?.inboundMessageId ?? null,
    channel: activeTurn?.channel ?? null,
    route: activeTurn?.route ?? null,
  });
  activeTurn = null;
}

export function getActiveTurnSendCount(): number {
  return activeTurn?.sendCount ?? 0;
}
