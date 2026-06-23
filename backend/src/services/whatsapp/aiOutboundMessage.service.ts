import prisma from '../../config/prisma';
import { maybeEnqueueOutboundAiReview } from '../../governance/aiGovernanceHook.service';

type AiOutboundMessageInput = {
  conversationId: string;
  companyId?: string;
  content: string;
  language?: string | null;
  mutationSucceeded?: boolean;
  hasInventoryAlternatives?: boolean;
};

export async function createAiOutboundMessage(input: AiOutboundMessageInput) {
  const message = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      senderType: 'ai',
      content: input.content,
      language: input.language || 'en',
      status: 'sent',
    },
  });

  let companyId = input.companyId;
  if (!companyId) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { companyId: true },
    });
    companyId = conversation?.companyId;
  }

  if (companyId) {
    void maybeEnqueueOutboundAiReview({
      companyId,
      messageId: message.id,
      content: input.content,
      mutationSucceeded: input.mutationSucceeded,
      hasInventoryAlternatives: input.hasInventoryAlternatives,
    }).catch(() => undefined);
  }

  return message;
}
