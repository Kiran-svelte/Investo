/**
 * Zero-UI proof: all 15 CRM workflows are wired for WhatsApp-only execution.
 * Staff copilot + buyer channel must mutate DB, calendar (visits), and lead status
 * without requiring dashboard clicks.
 */
const mockNotify = jest.fn().mockResolvedValue(undefined);
const mockScheduleVisit = jest.fn();
const mockSendText = jest.fn().mockResolvedValue(true);
const mockSendButtons = jest.fn().mockResolvedValue(true);
const mockCreateBookingApprovalRequest = jest.fn();
const mockFindPendingBookingApproval = jest.fn();
const mockResolveBookingApprovalStatus = jest.fn();
const mockGetBookingApprovalById = jest.fn();
const mockConfirmVisitById = jest.fn();
const mockTransitionLeadStatus = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    notification: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    property: { findUnique: jest.fn() },
    conversation: { update: jest.fn() },
  },
}));

jest.mock('../../services/notification.engine', () => ({
  notificationEngine: { notify: (...args: unknown[]) => mockNotify(...args) },
}));

jest.mock('../../services/visitBooking.service', () => ({
  scheduleVisit: (...args: unknown[]) => mockScheduleVisit(...args),
}));

jest.mock('../../services/bookingApproval.service', () => ({
  buildVisitApprovalIdempotencyKey: jest.fn((input: any) => `visit_approval:${input.companyId}:${input.leadId}:${input.propertyId}`),
  createBookingApprovalRequest: (...args: unknown[]) => mockCreateBookingApprovalRequest(...args),
  findPendingBookingApproval: (...args: unknown[]) => mockFindPendingBookingApproval(...args),
  resolveBookingApprovalStatus: (...args: unknown[]) => mockResolveBookingApprovalStatus(...args),
  getBookingApprovalById: (...args: unknown[]) => mockGetBookingApprovalById(...args),
  updatePendingBookingApprovalSchedule: jest.fn(),
  cancelPendingBookingApproval: jest.fn(),
}));

jest.mock('../../services/visitState.service', () => ({
  confirmVisitById: (...args: unknown[]) => mockConfirmVisitById(...args),
}));

jest.mock('../../services/leadTransition.service', () => ({
  transitionLeadStatus: (...args: unknown[]) => mockTransitionLeadStatus(...args),
}));

jest.mock('../../services/socket.service', () => ({
  SOCKET_EVENTS: { LEAD_UPDATED: 'lead_updated' },
  socketService: { emitToCompany: jest.fn() },
}));

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendCompanyTextMessage: (...args: unknown[]) => mockSendText(...args),
    sendCompanyInteractiveButtons: (...args: unknown[]) => mockSendButtons(...args),
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import prisma from '../../config/prisma';
import { WORKFLOW_GUIDE } from '../../services/workflow/workflow-catalog.util';
import { WORKFLOW_ACTION_HANDLERS } from '../../services/workflow/actions/index';
import {
  allWorkflowIds,
  getWorkflowDefinition,
  WORKFLOW_DEFINITIONS,
} from '../../services/workflow/workflow-registry';
import { AI_STACK_CAPABILITIES } from '../../constants/ai-capabilities.constants';
import { BUYER_WORKFLOW_IDS } from '../../constants/workflow.constants';
import {
  createVisitApprovalRequest,
  resolveVisitApproval,
} from '../../services/visitPendingApproval.service';

describe('Zero-UI workflows proof', () => {
  it('declares exactly 15 production workflows', () => {
    expect(allWorkflowIds()).toHaveLength(15);
    expect(WORKFLOW_GUIDE).toHaveLength(15);
    expect(AI_STACK_CAPABILITIES.workflow_engine.workflow_count).toBe(15);
  });

  it('every workflow has a handler for each required step', () => {
    for (const def of WORKFLOW_DEFINITIONS) {
      for (const step of def.steps) {
        if (step.optional) continue;
        expect(WORKFLOW_ACTION_HANDLERS[step.action]).toBeDefined();
      }
    }
  });

  it('visit booking workflow chain covers calendar + lead status (zero UI)', () => {
    const schedule = getWorkflowDefinition('schedule_visit');
    expect(schedule).toBeDefined();
    const actions = schedule!.steps.map((s) => s.action);
    expect(actions).toContain('bookVisit');
    expect(actions).toContain('updateLeadStatusVisitScheduled');
    expect(actions).toContain('scheduleVisitReminders');
  });

  it('buyer channel supports visit mutations without staff UI', () => {
    expect(BUYER_WORKFLOW_IDS).toEqual(
      expect.arrayContaining(['schedule_visit', 'reschedule_visit', 'cancel_visit']),
    );
  });

  it('staff router runs workflows before LLM fallback', () => {
    const order = AI_STACK_CAPABILITIES.staff_router_order;
    const workflowIdx = order.indexOf('classifyAndRunWorkflow');
    const llmIdx = order.indexOf('invokeAgent + clientMemory RAG');
    expect(workflowIdx).toBeGreaterThanOrEqual(0);
    expect(llmIdx).toBeGreaterThan(workflowIdx);
  });

  it('buyer router tries workflow engine before language brain', () => {
    const order = AI_STACK_CAPABILITIES.buyer_router_order;
    expect(order[1]).toContain('classifyAndRunBuyerWorkflow');
  });
});

describe('Zero-UI visit approval chain (buyer → agent WhatsApp → calendar + lead)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ name: 'Raj', phone: '+919888877777' });
    (prisma.property.findUnique as jest.Mock).mockResolvedValue({ name: 'Tower A', locationArea: 'Pune' });
    (prisma.conversation.update as jest.Mock).mockResolvedValue({});
    const approval = {
      id: 'appr-1',
      companyId: 'co-1',
      kind: 'visit',
      status: 'pending',
      leadId: 'lead-1',
      propertyId: 'prop-1',
      callRequestId: null,
      scheduledAt: new Date('2026-06-10T10:00:00+05:30'),
      agentId: 'agent-1',
      conversationId: 'conv-1',
      customerPhone: '+919999988888',
      customerName: 'Ravi',
      idempotencyKey: 'visit_approval:co-1:lead-1:prop-1',
      expiresAt: new Date('2026-06-10T14:00:00+05:30'),
      resolvedAt: null,
      metadata: { propertyName: 'Tower A' },
      createdAt: new Date('2026-06-10T09:00:00+05:30'),
      updatedAt: new Date('2026-06-10T09:00:00+05:30'),
    };
    mockCreateBookingApprovalRequest.mockResolvedValue({
      approval,
      created: true,
      idempotencyHit: false,
    });
    mockFindPendingBookingApproval.mockResolvedValue(approval);
    mockResolveBookingApprovalStatus.mockResolvedValue({ ...approval, status: 'approved' });
    mockGetBookingApprovalById.mockResolvedValue({ ...approval, metadata: {} });
    mockConfirmVisitById.mockResolvedValue({ success: true });
    mockTransitionLeadStatus.mockResolvedValue(true);
  });

  it('createVisitApprovalRequest pushes real-time notification + WhatsApp buttons (no dashboard)', async () => {
    await createVisitApprovalRequest({
      companyId: 'co-1',
      leadId: 'lead-1',
      propertyId: 'prop-1',
      scheduledAt: new Date('2026-06-10T10:00:00+05:30'),
      agentId: 'agent-1',
      conversationId: 'conv-1',
      customerPhone: '+919999988888',
      customerName: 'Ravi',
      propertyName: 'Tower A',
      suppressCustomerMessage: true,
    });

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'visit_scheduled',
        data: expect.objectContaining({ pendingApproval: true, leadId: 'lead-1', approvalId: 'appr-1' }),
      }),
    );
    expect(mockCreateBookingApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'visit',
        leadId: 'lead-1',
        propertyId: 'prop-1',
      }),
    );
    expect(mockSendButtons).toHaveBeenCalled();
  });

  it('resolveVisitApproval(approved) books visit via scheduleVisit (calendar + lead status)', async () => {
    const approvalId = 'appr-1';
    mockScheduleVisit.mockResolvedValue({
      success: true,
      visit: { id: 'visit-1', scheduledAt: new Date('2026-06-10T10:00:00+05:30') },
    });

    const result = await resolveVisitApproval(approvalId, true, 'co-1', 'agent-1');

    expect(result.ok).toBe(true);
    expect(mockScheduleVisit).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'co-1',
        leadId: 'lead-1',
        propertyId: 'prop-1',
        agentId: 'agent-1',
        notes: 'Confirmed by agent via WhatsApp',
      }),
    );
    expect(mockResolveBookingApprovalStatus).toHaveBeenCalledWith({ approvalId, status: 'approved' });
    expect(mockConfirmVisitById).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'co-1', visitId: 'visit-1' }),
    );
    expect(mockSendText).toHaveBeenCalled();
    expect(result.message).not.toMatch(/dashboard/i);
  });
});
