/// <reference types="jest" />

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    visit: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    lead: { update: jest.fn().mockResolvedValue({}) },
    $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/agent-action-log.service', () => ({
  __esModule: true,
  logAgentAction: jest.fn().mockResolvedValue(undefined),
}));

import prisma from '../../config/prisma';
import { logAgentAction } from '../../services/agent-action-log.service';
import {
  runCompensators,
  compensateCancelVisit,
} from '../../services/workflow/workflow-compensator.service';

describe('workflow-compensator saga hardening', () => {
  beforeEach(() => jest.clearAllMocks());

  it('compensateCancelVisit restores a cancelled visit to its prior status', async () => {
    const ok = await compensateCancelVisit('visit-1', 'scheduled', 'company-1');
    expect(ok).toBe(true);
    expect((prisma as any).visit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'visit-1', status: 'cancelled', companyId: 'company-1' }),
        data: expect.objectContaining({ status: 'scheduled' }),
      }),
    );
  });

  it('compensateCancelVisit is a no-op when there is no prior status', async () => {
    const ok = await compensateCancelVisit('visit-1', undefined, 'company-1');
    expect(ok).toBe(true);
    expect((prisma as any).visit.updateMany).not.toHaveBeenCalled();
  });

  it('rolls back a freed slot when bookVisit fails after cancelVisitSlot', async () => {
    const allOk = await runCompensators({
      workflowRunId: '11111111-1111-1111-1111-111111111111',
      failedStep: 'bookVisit',
      completedSteps: ['resolveVisit', 'cancelVisitSlot'],
      state: {
        cancelledSlotVisitId: 'slot-visit-1',
        cancelledSlotPriorStatus: 'scheduled',
      },
      stateSnapshot: {},
      companyId: 'company-1',
    });

    expect(allOk).toBe(true);

    // The freed slot was restored.
    expect((prisma as any).visit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'slot-visit-1', status: 'cancelled' }),
        data: expect.objectContaining({ status: 'scheduled' }),
      }),
    );

    // A compensation log and a partial-rollback trace were written.
    const actions = (logAgentAction as jest.Mock).mock.calls.map((c) => c[0].action);
    expect(actions).toContain('compensate_cancel_visit_slot');
    expect(actions).toContain('workflow_partial_rollback');
  });

  it('flags needs_reconciliation when a compensator fails', async () => {
    (prisma as any).visit.updateMany.mockRejectedValueOnce(new Error('db down'));

    const allOk = await runCompensators({
      workflowRunId: '22222222-2222-2222-2222-222222222222',
      failedStep: 'bookVisit',
      completedSteps: ['cancelVisitSlot'],
      state: { cancelledSlotVisitId: 'slot-2', cancelledSlotPriorStatus: 'confirmed' },
      stateSnapshot: {},
      companyId: 'company-1',
    });

    expect(allOk).toBe(false);
    const reconcileLog = (logAgentAction as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((a) => a.action === 'workflow_needs_reconciliation');
    expect(reconcileLog).toBeDefined();
    expect(reconcileLog.status).toBe('failed');
  });
});
