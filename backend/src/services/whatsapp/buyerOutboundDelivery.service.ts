import prisma from '../../config/prisma';
import { buildSafeBuyerFallback } from '../../utils/safeBuyerFallback.util';
import type { TurnResult } from '../../types/whatsapp-turn.types';

export type BuyerOutboundRecoveryInput = {
  conversationId: string;
  inboundMessageId?: string | null;
  turnResult?: TurnResult | null;
  customerMessage?: string;
  activeVisitPropertyName?: string | null;
  customerName?: string | null;
};

/**
 * Ensures every buyer turn has text to deliver on WhatsApp.
 * Fast paths may persist AI rows before the outer dispatcher runs.
 */
export async function resolveBuyerOutboundText(input: BuyerOutboundRecoveryInput): Promise<string> {
  const fromTurn = input.turnResult?.text?.trim();
  if (fromTurn) return fromTurn;

  const inboundId = input.inboundMessageId?.trim();
  if (inboundId) {
    const customerMsg = await prisma.message.findFirst({
      where: { whatsappMessageId: inboundId },
      select: { conversationId: true, createdAt: true },
    });
    if (customerMsg) {
      const aiMsg = await prisma.message.findFirst({
        where: {
          conversationId: customerMsg.conversationId,
          senderType: { in: ['ai', 'agent'] },
          createdAt: { gte: customerMsg.createdAt },
          NOT: { content: { equals: '' } },
        },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      });
      const recovered = aiMsg?.content?.trim();
      if (recovered) return recovered;
    }
  }

  if (input.conversationId) {
    const recentAi = await prisma.message.findFirst({
      where: {
        conversationId: input.conversationId,
        senderType: { in: ['ai', 'agent'] },
        createdAt: { gte: new Date(Date.now() - 120_000) },
        content: { not: '' },
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    const recovered = recentAi?.content?.trim();
    if (recovered) return recovered;
  }

  if (input.activeVisitPropertyName) {
    return buildSafeBuyerFallback({
      activeVisit: {
        propertyName: input.activeVisitPropertyName,
        scheduledAt: new Date(),
        status: 'scheduled',
      },
    });
  }

  const msg = input.customerMessage ?? '';
  const isVisitQuery = /\b(visit|booking|booked|scheduled|appointment)\b/i.test(msg);
  if (isVisitQuery) {
    const salutation = input.customerName?.trim() ? `, ${input.customerName.trim()}` : '';
    return (
      `I could not safely fetch your visit details just now${salutation}. ` +
      'Our team is being notified, and I will only use confirmed visit information.'
    );
  }

  return buildSafeBuyerFallback();
}

export function mergeTurnResultWithOutboundText(
  turnResult: TurnResult,
  outboundText: string,
): TurnResult {
  return {
    ...turnResult,
    handled: true,
    terminal: turnResult.terminal ?? true,
    text: outboundText,
  };
}
