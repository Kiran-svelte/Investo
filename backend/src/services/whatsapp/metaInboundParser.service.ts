export type MetaInboundNormalizedType = 'text' | 'interactive';

export type ParsedCustomerTurn = {
  messageText: string;
  normalizedType: MetaInboundNormalizedType;
  interactiveId?: string;
  interactiveType?: 'button_reply' | 'list_reply';
};

type MetaWebhookMessage = {
  type?: string;
  text?: { body?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
};

/**
 * Extract customer-visible text and interactive metadata from a Meta webhook message.
 */
export function extractCustomerMessage(message: MetaWebhookMessage): ParsedCustomerTurn | null {
  if (message.type === 'text' && typeof message.text?.body === 'string') {
    return {
      messageText: message.text.body,
      normalizedType: 'text',
    };
  }

  if (message.type === 'interactive') {
    if (message.interactive?.button_reply) {
      const buttonReply = message.interactive.button_reply;
      return {
        messageText: buttonReply.title || '',
        normalizedType: 'interactive',
        interactiveId: buttonReply.id,
        interactiveType: 'button_reply',
      };
    }

    if (message.interactive?.list_reply) {
      const listReply = message.interactive.list_reply;
      const text = listReply.description || listReply.title || '';
      return {
        messageText: text,
        normalizedType: 'interactive',
        interactiveId: listReply.id,
        interactiveType: 'list_reply',
      };
    }

    return null;
  }

  return null;
}
