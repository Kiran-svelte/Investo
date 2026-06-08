/// <reference types="jest" />

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockClaimInboundFull = jest.fn().mockResolvedValue(true);
const mockClaimFingerprint = jest.fn().mockResolvedValue(true);
const mockClaimProcessing = jest.fn().mockResolvedValue(true);
const mockRouteStaff = jest.fn().mockResolvedValue({ handled: false, route: { kind: 'customer' } });
const mockEnqueue = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/inboundMessageGuard.service', () => ({
  __esModule: true,
  claimInboundMessageFull: (...args: unknown[]) => mockClaimInboundFull(...args),
  claimCustomerInboundFingerprint: (...args: unknown[]) => mockClaimFingerprint(...args),
  claimCustomerProcessingTurn: (...args: unknown[]) => mockClaimProcessing(...args),
}));

jest.mock('../../services/inboundWhatsAppRouting.service', () => ({
  __esModule: true,
  routeCompanyScopedInbound: (...args: unknown[]) => mockRouteStaff(...args),
  findCompanyUserByPhone: jest.fn(),
}));

jest.mock('../../services/customerInboundQueue.service', () => ({
  __esModule: true,
  enqueueCustomerInbound: (...args: unknown[]) => mockEnqueue(...args),
}));

jest.mock('../../services/outboundTurnDebug.service', () => ({
  __esModule: true,
  logOutboundBranch: jest.fn(),
}));

import { runInboundProspectGuards } from '../../services/whatsapp/inboundGuardPipeline.service';

const NOT_ATTEMPTED = { status: 'not_attempted' as const };

const baseMsg = {
  phoneNumberId: 'pnid-1',
  customerPhone: '+919999999999',
  customerName: 'Buyer',
  messageText: 'Hello',
  messageId: 'wamid-guard-1',
};

describe('inboundGuardPipeline.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClaimInboundFull.mockResolvedValue(true);
    mockClaimFingerprint.mockResolvedValue(true);
    mockClaimProcessing.mockResolvedValue(true);
    mockRouteStaff.mockResolvedValue({ handled: false, route: { kind: 'customer' } });
  });

  it('skips duplicate messageId when inbound claim fails', async () => {
    mockClaimInboundFull.mockResolvedValueOnce(false);

    const result = await runInboundProspectGuards({
      msg: baseMsg,
      companyId: 'co-1',
      customerPhone: '+919999999999',
      notAttempted: NOT_ATTEMPTED,
    });

    expect(result.action).toBe('skip');
    if (result.action === 'skip') {
      expect(result.result.reason).toBe('duplicate_message_id');
    }
  });

  it('skips duplicate customer fingerprint for plain text', async () => {
    mockClaimFingerprint.mockResolvedValueOnce(false);

    const result = await runInboundProspectGuards({
      msg: baseMsg,
      companyId: 'co-1',
      customerPhone: '+919999999999',
      notAttempted: NOT_ATTEMPTED,
    });

    expect(result.action).toBe('skip');
    if (result.action === 'skip') {
      expect(result.result.reason).toBe('duplicate_customer_fingerprint');
    }
  });

  it('does not fingerprint interactive taps', async () => {
    const result = await runInboundProspectGuards({
      msg: { ...baseMsg, interactiveId: 'call-me', messageId: 'wamid-int-1' },
      companyId: 'co-1',
      customerPhone: '+919999999999',
      notAttempted: NOT_ATTEMPTED,
    });

    expect(mockClaimFingerprint).not.toHaveBeenCalled();
    expect(result.action).toBe('proceed');
  });

  it('bypasses concurrent lock for interactive taps', async () => {
    mockClaimProcessing.mockResolvedValueOnce(false);

    const result = await runInboundProspectGuards({
      msg: { ...baseMsg, interactiveId: 'filter-2bhk', messageId: 'wamid-int-2' },
      companyId: 'co-1',
      customerPhone: '+919999999999',
      notAttempted: NOT_ATTEMPTED,
    });

    expect(mockClaimProcessing).not.toHaveBeenCalled();
    expect(result.action).toBe('proceed');
  });

  it('queues concurrent plain-text inbound when lock is held', async () => {
    mockClaimProcessing.mockResolvedValueOnce(false);

    const result = await runInboundProspectGuards({
      msg: baseMsg,
      companyId: 'co-1',
      customerPhone: '+919999999999',
      notAttempted: NOT_ATTEMPTED,
    });

    expect(result.action).toBe('skip');
    if (result.action === 'skip') {
      expect(result.result.reason).toBe('concurrent_customer_processing');
    }
    expect(mockEnqueue).toHaveBeenCalledWith(
      'co-1',
      '+919999999999',
      expect.objectContaining({ messageId: 'wamid-guard-1' }),
    );
  });

  it('skips inbound dedup re-claim on queuedReplay', async () => {
    await runInboundProspectGuards({
      msg: { ...baseMsg, queuedReplay: true },
      companyId: 'co-1',
      customerPhone: '+919999999999',
      notAttempted: NOT_ATTEMPTED,
    });

    expect(mockClaimInboundFull).not.toHaveBeenCalled();
  });
});
