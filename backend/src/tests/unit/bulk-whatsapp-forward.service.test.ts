import {
  resolveBulkForwardPlan,
  executeBulkWhatsAppForward,
} from '../../services/bulk-whatsapp-forward.service';

const mockSendStaffBulk = jest.fn();

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendStaffBulkTextMessage: (...args: unknown[]) => mockSendStaffBulk(...args),
  },
}));

describe('bulk-whatsapp-forward.service', () => {
  beforeEach(() => {
    mockSendStaffBulk.mockReset();
    mockSendStaffBulk.mockResolvedValue(true);
  });

  test('resolveBulkForwardPlan prefers parsed phones over LLM staff-only subset', () => {
    const raw = 'Send "Hello team" to 9036165603, 9876543210';
    const plan = resolveBulkForwardPlan(raw, 'Hello team', ['9036165603']);
    expect(plan?.phones).toHaveLength(2);
    expect(plan?.phones[0]).toMatch(/9036165603/);
    expect(plan?.phones[1]).toMatch(/9876543210/);
  });

  test('executeBulkWhatsAppForward sends to every parsed phone (staff + client)', async () => {
    mockSendStaffBulk
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const result = await executeBulkWhatsAppForward({
      companyId: 'co-1',
      body: 'Hello team',
      phones: ['+919036165603', '+919876543210'],
    });

    expect(mockSendStaffBulk).toHaveBeenCalledTimes(2);
    expect(mockSendStaffBulk).toHaveBeenNthCalledWith(
      1,
      '+919036165603',
      'Hello team',
      'co-1',
    );
    expect(mockSendStaffBulk).toHaveBeenNthCalledWith(
      2,
      '+919876543210',
      'Hello team',
      'co-1',
    );
    expect(result.sent).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
  });
});
