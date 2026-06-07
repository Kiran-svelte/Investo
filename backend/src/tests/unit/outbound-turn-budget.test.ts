import {
  beginOutboundTurn,
  claimPrimaryOutboundSend,
  endOutboundTurn,
  getActiveTurnSendCount,
  releasePrimaryOutboundClaim,
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

  test('releasePrimaryOutboundClaim allows text fallback after interactive failure', () => {
    beginOutboundTurn({
      channel: 'buyer',
      inboundMessageId: 'wamid-test-3',
      companyId: 'co-1',
      customerPhone: '+919876543210',
      route: 'buyer_inbound',
    });

    expect(claimPrimaryOutboundSend('H5', 'test', 'buttons', '+919876543210')).toBe(true);
    expect(claimPrimaryOutboundSend('H5', 'test', 'fallback', '+919876543210')).toBe(false);
    releasePrimaryOutboundClaim('H5', 'test', 'buttons_failed');
    expect(claimPrimaryOutboundSend('H5', 'test', 'fallback_text', '+919876543210')).toBe(true);
  });
});
