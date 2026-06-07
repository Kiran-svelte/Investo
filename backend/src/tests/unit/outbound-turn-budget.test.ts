import {
  beginOutboundTurn,
  claimPrimaryOutboundSend,
  endOutboundTurn,
  getActiveTurnSendCount,
} from '../../services/outboundTurnDebug.service';

describe('outbound turn budget (one customer reply per turn)', () => {
  afterEach(() => {
    endOutboundTurn('test_cleanup');
  });

  test('blocks second primary send to same customer phone', () => {
    beginOutboundTurn({
      channel: 'buyer',
      inboundMessageId: 'wamid-test-1',
      companyId: 'co-1',
      customerPhone: '+919876543210',
      route: 'buyer_inbound',
    });

    expect(claimPrimaryOutboundSend('H1', 'test', 'first', '+919876543210')).toBe(true);
    expect(claimPrimaryOutboundSend('H1', 'test', 'second', '+919876543210')).toBe(false);
    expect(getActiveTurnSendCount()).toBe(0);
  });

  test('allows agent notification to different phone in same turn', () => {
    beginOutboundTurn({
      channel: 'buyer',
      inboundMessageId: 'wamid-test-2',
      companyId: 'co-1',
      customerPhone: '+919876543210',
      route: 'buyer_inbound',
    });

    expect(claimPrimaryOutboundSend('H1', 'test', 'customer', '+919876543210')).toBe(true);
    expect(claimPrimaryOutboundSend('H1', 'test', 'agent', '+919000000001')).toBe(true);
  });
});
