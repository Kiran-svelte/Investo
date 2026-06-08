/**
 * Buyer session taxonomy (full.md PART II).
 * Single source for hasPriorOutbound and conversation history window.
 */
import prisma from '../../config/prisma';

/** full.md §II.1 — last N messages loaded for turn context. */
export const BUYER_CONVERSATION_HISTORY_LIMIT = 30;

export type ConversationHistoryRow = {
  senderType: string;
  content: string;
  createdAt: Date;
};

/** full.md §II.2 session classes (detection helpers for tests / logging). */
export type BuyerSessionClass =
  | 'first_conversation'
  | 'returning_greeting'
  | 'returning_pivot'
  | 'continued_thread'
  | 'fresh_restart';

/**
 * True when prior AI or agent outbound exists in the loaded history window.
 * full.md §II.1
 */
export function computeHasPriorOutbound(
  history: Array<{ senderType: string }>,
): boolean {
  return history.some((m) => m.senderType === 'ai' || m.senderType === 'agent');
}

/**
 * Loads ascending conversation messages for buyer turn context (default 30).
 */
export async function loadConversationHistory(
  conversationId: string,
  limit: number = BUYER_CONVERSATION_HISTORY_LIMIT,
): Promise<ConversationHistoryRow[]> {
  return prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: {
      senderType: true,
      content: true,
      createdAt: true,
    },
  });
}

const START_COMMAND = /^\/start[\s!]*$/i;
const BARE_GREETING = /^(hi|hello|hey|good\s+(morning|afternoon|evening))[\s,!]*$/i;
const RETURNING_PIVOT =
  /^(something\s+new|new\s+search|start\s+(?:over|fresh|again)|explore\s+(?:something\s+)?(?:new|else|different)|different\s+(?:property|project|area)|fresh\s+start|yes\s+something\s+new)[\s.!?]*$/i;

/**
 * Classifies inbound into PART II session table (for diagnostics — handlers use predicates separately).
 */
export function classifyBuyerSession(input: {
  messageText: string;
  hasPriorOutbound: boolean;
}): BuyerSessionClass {
  const t = input.messageText.trim();
  if (START_COMMAND.test(t)) return 'fresh_restart';
  if (!input.hasPriorOutbound) return 'first_conversation';
  if (BARE_GREETING.test(t)) return 'returning_greeting';
  if (RETURNING_PIVOT.test(t)) return 'returning_pivot';
  return 'continued_thread';
}
