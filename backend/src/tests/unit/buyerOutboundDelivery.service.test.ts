const mockFindFirst = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    message: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}));

import {
  mergeTurnResultWithOutboundText,
  resolveBuyerOutboundText,
} from '../../services/whatsapp/buyerOutboundDelivery.service';

describe('buyerOutboundDelivery.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindFirst.mockResolvedValue(null);
  });

  it('prefers turnResult text when present', async () => {
    const text = await resolveBuyerOutboundText({
      conversationId: 'conv-1',
      turnResult: {
        audience: 'buyer',
        handled: true,
        terminal: true,
        text: 'Hello buyer',
      },
    });
    expect(text).toBe('Hello buyer');
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('recovers AI transcript written before outer dispatch', async () => {
    mockFindFirst
      .mockResolvedValueOnce({ conversationId: 'conv-1', createdAt: new Date('2026-06-25T10:00:00Z') })
      .mockResolvedValueOnce({ content: 'Recovered from DB' });

    const text = await resolveBuyerOutboundText({
      conversationId: 'conv-1',
      inboundMessageId: 'wamid-1',
      turnResult: { audience: 'buyer', handled: true, terminal: true, text: '' },
    });

    expect(text).toBe('Recovered from DB');
  });

  it('falls back to safe buyer copy when nothing is recoverable', async () => {
    const text = await resolveBuyerOutboundText({
      conversationId: 'conv-1',
      turnResult: { audience: 'buyer', handled: true, terminal: true },
      customerMessage: 'hello',
    });
    expect(text.length).toBeGreaterThan(20);
  });

  it('merges recovered text into turn result', () => {
    const merged = mergeTurnResultWithOutboundText(
      { audience: 'buyer', handled: true, terminal: true },
      'Deliver me',
    );
    expect(merged.text).toBe('Deliver me');
    expect(merged.handled).toBe(true);
  });
});
