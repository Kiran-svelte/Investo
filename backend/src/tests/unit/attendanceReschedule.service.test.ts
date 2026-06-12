/// <reference types="jest" />

const mockFindFirst = jest.fn();
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockCreate = jest.fn();
const mockRescheduleVisitById = jest.fn();
const mockSendCompanyTextMessage = jest.fn();
const mockClearStaffRescheduleRequest = jest.fn();
const mockReadStaffRescheduleRequest = jest.fn();
const mockMergeLeadMetadataRaw = jest.fn((existing: unknown, patch: Record<string, unknown>) => ({
  ...(typeof existing === 'object' && existing ? existing : {}),
  ...patch,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    features: { attendanceStaffRescheduleFlow: true },
  },
}));

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    visit: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
    lead: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    pendingAction: {
      update: (...args: unknown[]) => mockUpdate(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
    conversation: {
      findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }),
      update: jest.fn().mockResolvedValue(undefined),
    },
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/agent-action-log.service', () => ({
  logAgentAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/visitState.service', () => ({
  rescheduleVisitById: (...args: unknown[]) => mockRescheduleVisitById(...args),
}));

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendCompanyTextMessage: (...args: unknown[]) => mockSendCompanyTextMessage(...args),
  },
}));

jest.mock('../../utils/staffRescheduleRequest.util', () => ({
  mergeLeadMetadataRaw: (existing: unknown, patch: Record<string, unknown>) =>
    mockMergeLeadMetadataRaw(existing, patch),
  readStaffRescheduleRequest: (...args: unknown[]) => mockReadStaffRescheduleRequest(...args),
  clearStaffRescheduleRequest: (...args: unknown[]) => mockClearStaffRescheduleRequest(...args),
}));

import {
  handleAttendanceCheckReschedule,
  tryCompleteStaffRequestedReschedule,
} from '../../services/attendanceReschedule.service';

describe('attendanceReschedule.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendCompanyTextMessage.mockResolvedValue(undefined);
    mockClearStaffRescheduleRequest.mockResolvedValue(undefined);
  });

  test('handleAttendanceCheckReschedule messages customer and sets pending action', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'visit-1',
      companyId: 'co-1',
      leadId: 'lead-1',
      status: 'confirmed',
      lead: { id: 'lead-1', phone: '919999999999', customerName: 'Rahul' },
      property: { name: 'Lake Vista' },
      agent: { id: 'agent-1', name: 'Priya' },
    });
    mockFindUnique.mockResolvedValue({ metadata: {} });

    const reply = await handleAttendanceCheckReschedule({
      companyId: 'co-1',
      sessionId: 'sess-1',
      agentUserId: 'agent-1',
      agentPhone: '918888888888',
      pendingActionId: 'pa-1',
      params: {
        visitId: 'visit-1',
        leadId: 'lead-1',
        customerPhone: '919999999999',
        customerName: 'Rahul',
        propertyName: 'Lake Vista',
      },
    });

    expect(reply).toContain('Reschedule started');
    expect(reply).toContain('Rahul');
    expect(mockSendCompanyTextMessage).toHaveBeenCalledWith(
      '919999999999',
      expect.stringContaining('Which date and time works'),
      'co-1',
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actionType: 'attendance_reschedule_awaiting_customer' }),
      }),
    );
  });

  test('tryCompleteStaffRequestedReschedule reschedules visit when customer replies with time', async () => {
    const newTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    mockReadStaffRescheduleRequest.mockResolvedValue({
      staff_reschedule_visit_id: 'visit-1',
      staff_reschedule_agent_id: 'agent-1',
    });
    mockFindFirst.mockResolvedValue({
      id: 'visit-1',
      companyId: 'co-1',
      leadId: 'lead-1',
      lead: { customerName: 'Rahul' },
      property: { name: 'Lake Vista' },
      agent: { id: 'agent-1', name: 'Priya', phone: '918888888888' },
    });
    mockRescheduleVisitById.mockResolvedValue({
      success: true,
      visit: { id: 'visit-1', scheduledAt: newTime },
    });

    const result = await tryCompleteStaffRequestedReschedule({
      companyId: 'co-1',
      leadId: 'lead-1',
      customerMessage: 'Saturday 4pm',
    });

    expect(result?.committed).toBe(true);
    expect(result?.mode).toBe('rescheduled');
    expect(mockRescheduleVisitById).toHaveBeenCalledWith(
      expect.objectContaining({
        visitId: 'visit-1',
        scheduledAt: expect.any(Date),
      }),
    );
    expect(mockClearStaffRescheduleRequest).toHaveBeenCalledWith('lead-1');
    expect(mockSendCompanyTextMessage).toHaveBeenCalledWith(
      '918888888888',
      expect.stringContaining('Visit rescheduled'),
      'co-1',
    );
  });

  test('tryCompleteStaffRequestedReschedule returns null without staff request metadata', async () => {
    mockReadStaffRescheduleRequest.mockResolvedValue(null);
    const result = await tryCompleteStaffRequestedReschedule({
      companyId: 'co-1',
      leadId: 'lead-1',
      customerMessage: 'Saturday 4pm',
    });
    expect(result).toBeNull();
    expect(mockRescheduleVisitById).not.toHaveBeenCalled();
  });
});
