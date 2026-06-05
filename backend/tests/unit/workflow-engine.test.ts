/**
 * Unit tests for the workflow engine's tryRunBuyerWorkflow and runWorkflowForIntent.
 *
 * Covers the two critical bugs fixed:
 * 1. Raw error strings from workflow failures were returned directly to customers.
 * 2. Double-execution: when runWorkflowForIntent returned null, executeAgentIntent
 *    ran the same intent again.
 */

import { tryRunBuyerWorkflow } from '../../../src/services/workflow/workflow-engine.service';

// Mock the entire workflow engine internals — we only test the public surface
jest.mock('../../../src/config/prisma', () => ({ default: { $connect: jest.fn() } }));
jest.mock('../../../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../src/config/redis', () => ({ getRedis: jest.fn(() => null), getCacheType: jest.fn(() => 'memory') }));
jest.mock('../../../src/services/clientMemory.service', () => ({
  setAgentSessionClientContext: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../src/services/workflow/workflow-registry', () => ({
  getWorkflowDefinition: jest.fn(),
  workflowIdForIntent: jest.fn(),
  allWorkflowIds: jest.fn(() => []),
}));
jest.mock('../../../src/services/workflow/workflow-engine.service', () => {
  const actual = jest.requireActual('../../../src/services/workflow/workflow-engine.service');
  return { ...actual };
});

// Helper to create the runWorkflow mock result inline
import * as WorkflowEngine from '../../../src/services/workflow/workflow-engine.service';

describe('tryRunBuyerWorkflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when message does not match any buyer workflow keyword', async () => {
    const result = await tryRunBuyerWorkflow({
      companyId: 'company-1',
      messageText: 'hello how are you',
      leadId: 'lead-1',
    });
    expect(result).toBeNull();
  });

  it('returns null when workflow fails (e.g. propertyId missing)', async () => {
    // Spy on runWorkflow to simulate a failure result
    const spy = jest.spyOn(WorkflowEngine, 'runWorkflow' as never).mockResolvedValue({
      ok: false,
      reply: 'Which property brochure should I send?',
      workflowId: 'brochure_request',
    } as never);

    const result = await tryRunBuyerWorkflow({
      companyId: 'company-1',
      messageText: 'send me the brochure',
      leadId: 'lead-1',
    });

    // BUG FIX: Must return null, NOT the raw error string "Which property brochure should I send?"
    // Previously this raw error was sent directly to the WhatsApp customer.
    expect(result).toBeNull();
    spy.mockRestore();
  });

  it('returns null when workflow succeeds but produces no reply (all steps skipped)', async () => {
    const spy = jest.spyOn(WorkflowEngine, 'runWorkflow' as never).mockResolvedValue({
      ok: true,
      reply: null,
      workflowId: 'price_inquiry',
    } as never);

    const result = await tryRunBuyerWorkflow({
      companyId: 'company-1',
      messageText: 'what is the price',
      leadId: 'lead-1',
    });

    expect(result).toBeNull();
    spy.mockRestore();
  });

  it('returns the reply when workflow succeeds with a message', async () => {
    const spy = jest.spyOn(WorkflowEngine, 'runWorkflow' as never).mockResolvedValue({
      ok: true,
      reply: '2BHK starts at ₹85 Lakhs. Contact us to book a site visit!',
      workflowId: 'price_inquiry',
    } as never);

    const result = await tryRunBuyerWorkflow({
      companyId: 'company-1',
      messageText: 'what is the price?',
      leadId: 'lead-1',
    });

    expect(result).toBe('2BHK starts at ₹85 Lakhs. Contact us to book a site visit!');
    spy.mockRestore();
  });

  it('does not call runWorkflow when messageText is empty', async () => {
    const spy = jest.spyOn(WorkflowEngine, 'runWorkflow' as never);

    const result = await tryRunBuyerWorkflow({
      companyId: 'company-1',
      messageText: '',
    });

    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('runWorkflowForIntent', () => {
  it('returns null when no workflow is mapped for the intent', async () => {
    const { workflowIdForIntent } = await import('../../../src/services/workflow/workflow-registry');
    (workflowIdForIntent as jest.Mock).mockReturnValue(null);

    const { runWorkflowForIntent } = await import('../../../src/services/workflow/workflow-engine.service');
    const result = await runWorkflowForIntent(
      'unknown' as never,
      {},
      { toolContext: { userId: 'u', companyId: 'c', userRole: 'sales_agent', userName: 'Test' }, messageText: '', recentMessages: [], companyName: '', channel: 'staff' },
    );

    // null = "no workflow mapped" → caller MAY fall through to executeAgentIntent
    expect(result).toBeNull();
  });

  it('returns empty string (not null) when workflow runs but all steps skip', async () => {
    const { workflowIdForIntent } = await import('../../../src/services/workflow/workflow-registry');
    (workflowIdForIntent as jest.Mock).mockReturnValue('add_note');

    const spy = jest.spyOn(WorkflowEngine, 'runWorkflow' as never).mockResolvedValue({
      ok: true,
      reply: null, // all steps skipped
      workflowId: 'add_note',
    } as never);

    const { runWorkflowForIntent } = await import('../../../src/services/workflow/workflow-engine.service');
    const result = await runWorkflowForIntent(
      'add_lead_note' as never,
      {},
      { toolContext: { userId: 'u', companyId: 'c', userRole: 'sales_agent', userName: 'Test' }, messageText: '', recentMessages: [], companyName: '', channel: 'staff' },
    );

    // BUG FIX: empty string (not null) — prevents double-execution via executeAgentIntent fallback.
    // If this returned null, the orchestrator would fall through and run the same intent again.
    expect(result).toBe('');
    spy.mockRestore();
  });
});
