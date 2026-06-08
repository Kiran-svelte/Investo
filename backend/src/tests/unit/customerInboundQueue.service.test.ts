/// <reference types="jest" />

jest.mock('../../config/redis', () => ({
  __esModule: true,
  getRedis: jest.fn(() => null),
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockHandleIncoming = jest.fn().mockResolvedValue({ status: 'processed' });

jest.mock('../../services/whatsapp.service', () => ({
  __esModule: true,
  whatsappService: {
    handleIncomingMessage: (...args: unknown[]) => mockHandleIncoming(...args),
  },
}));

import {
  _resetCustomerInboundQueuesForTests,
  dequeueCustomerInbound,
  drainCustomerInboundQueue,
  enqueueCustomerInbound,
  type QueuedCustomerInbound,
} from '../../services/customerInboundQueue.service';

const COMPANY_ID = 'company-test-001';
const PHONE = '+919876543210';

function samplePayload(suffix: string): QueuedCustomerInbound {
  return {
    phoneNumberId: 'phone-id-1',
    customerPhone: PHONE,
    customerName: 'Test Buyer',
    messageText: `message ${suffix}`,
    messageId: `wamid.test.${suffix}`,
  };
}

describe('customerInboundQueue.service', () => {
  beforeEach(() => {
    _resetCustomerInboundQueuesForTests();
    mockHandleIncoming.mockClear();
  });

  it('enqueues and dequeues in FIFO order (memory fallback)', async () => {
    await enqueueCustomerInbound(COMPANY_ID, PHONE, samplePayload('a'));
    await enqueueCustomerInbound(COMPANY_ID, PHONE, samplePayload('b'));

    const first = await dequeueCustomerInbound(COMPANY_ID, PHONE);
    const second = await dequeueCustomerInbound(COMPANY_ID, PHONE);
    const third = await dequeueCustomerInbound(COMPANY_ID, PHONE);

    expect(first?.messageId).toBe('wamid.test.a');
    expect(second?.messageId).toBe('wamid.test.b');
    expect(third).toBeNull();
  });

  it('drain replays queued inbound with queuedReplay flag', async () => {
    await enqueueCustomerInbound(COMPANY_ID, PHONE, samplePayload('drain'));
    await drainCustomerInboundQueue(COMPANY_ID, PHONE);

    expect(mockHandleIncoming).toHaveBeenCalledTimes(1);
    expect(mockHandleIncoming).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'wamid.test.drain',
        queuedReplay: true,
      }),
    );
  });

  it('drain is a no-op when queue is empty', async () => {
    await drainCustomerInboundQueue(COMPANY_ID, PHONE);
    expect(mockHandleIncoming).not.toHaveBeenCalled();
  });
});
