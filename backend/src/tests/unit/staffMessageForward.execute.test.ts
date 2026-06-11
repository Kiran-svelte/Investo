import { tryStaffMessageForward } from '../../services/staffMessageForward.service';
import type { CompanyUserMatch } from '../../services/inboundWhatsAppRouting.service';

const mockExecuteBulk = jest.fn();

jest.mock('../../services/bulk-whatsapp-forward.service', () => ({
  resolveBulkForwardPlan: jest.requireActual('../../services/bulk-whatsapp-forward.service')
    .resolveBulkForwardPlan,
  executeBulkWhatsAppForward: (...args: unknown[]) => mockExecuteBulk(...args),
  formatBulkForwardStaffReply: jest.requireActual('../../services/bulk-whatsapp-forward.service')
    .formatBulkForwardStaffReply,
}));

jest.mock('../../services/agent-action-log.service', () => ({
  logAgentAction: jest.fn(),
}));

describe('tryStaffMessageForward', () => {
  const user: CompanyUserMatch = {
    userId: 'user-1',
    companyId: 'co-1',
    companyName: 'Investo',
    userRole: 'company_admin',
    userName: 'Admin',
    phone: '+919000000001',
  };

  beforeEach(() => {
    mockExecuteBulk.mockReset();
  });

  test('forwards to mixed staff and client phones from parsed command', async () => {
    mockExecuteBulk.mockResolvedValue({
      body: 'Hello team',
      sent: ['***5603', '***3210'],
      failed: [],
    });

    const result = await tryStaffMessageForward({
      user,
      messageText: 'Send "Hello team" to 9036165603, 9876543210',
    });

    expect(result).toEqual({
      handled: true,
      text: expect.stringContaining('*Message sent* to 2 numbers'),
    });
    expect(mockExecuteBulk).toHaveBeenCalledWith({
      companyId: 'co-1',
      body: 'Hello team',
      phones: expect.arrayContaining([
        expect.stringMatching(/9036165603/),
        expect.stringMatching(/9876543210/),
      ]),
    });
  });

  test('viewer role does not handle bulk send', async () => {
    const result = await tryStaffMessageForward({
      user: { ...user, userRole: 'viewer' },
      messageText: 'Send "Hello" to 9876543210',
    });
    expect(result).toEqual({ handled: false });
    expect(mockExecuteBulk).not.toHaveBeenCalled();
  });
});
