/// <reference types="jest" />

import { BUYER_HANDLER_CASCADE } from '../../services/whatsapp/whatsappTurnOrchestrator.service';
import {
  buildBuyerStartFreshReply,
  isBuyerStartCommand,
  resetBuyerBookingAndConversationState,
} from '../../services/buyer/buyerStartFresh.service';
import { computeHasPriorOutbound } from '../../services/buyer/buyerSession.util';

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    message: { findFirst: jest.fn() },
    notification: { create: jest.fn() },
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    aiSetting: { findUnique: jest.fn() },
    $transaction: jest.fn(),
    visit: { findMany: jest.fn(), updateMany: jest.fn() },
    conversation: { update: jest.fn() },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../services/buyer/buyerStartFresh.service', () => ({
  __esModule: true,
  isBuyerStartCommand: jest.fn(),
  buildBuyerStartFreshReply: jest.fn(),
  resetBuyerBookingAndConversationState: jest.fn(),
}));

describe('whatsappTurnOrchestrator handlers (chunk 03)', () => {
  it('declares immutable cascade order per full.md PART III.O', () => {
    expect(BUYER_HANDLER_CASCADE[0]).toBe('H-start');
    expect(BUYER_HANDLER_CASCADE[1]).toBe('H1');
    expect(BUYER_HANDLER_CASCADE[2]).toBe('H0');
    expect(BUYER_HANDLER_CASCADE.indexOf('H1b')).toBeLessThan(BUYER_HANDLER_CASCADE.indexOf('H2'));
    expect(BUYER_HANDLER_CASCADE[BUYER_HANDLER_CASCADE.length - 1]).toBe('H9');
  });

  it('/start command detection matches full.md H-start', () => {
    (isBuyerStartCommand as jest.Mock).mockImplementation(
      (t: string) => t.trim().toLowerCase() === '/start',
    );
    expect(isBuyerStartCommand('/start')).toBe(true);
    expect(isBuyerStartCommand('  /START  ')).toBe(true);
    expect(isBuyerStartCommand('start')).toBe(false);
  });

  it('buildBuyerStartFreshReply mentions fresh start', () => {
    (buildBuyerStartFreshReply as jest.Mock).mockReturnValue(
      "You're starting fresh with *Acme*!",
    );
    expect(buildBuyerStartFreshReply('Acme')).toContain('fresh');
  });

  it('H1b requires prior outbound via buyerSession.util', () => {
    expect(computeHasPriorOutbound([])).toBe(false);
    expect(computeHasPriorOutbound([{ senderType: 'ai' }])).toBe(true);
  });

  it('resetBuyerBookingAndConversationState is exported for H-start', () => {
    expect(typeof resetBuyerBookingAndConversationState).toBe('function');
  });
});

describe('whatsappTurnOrchestrator handlers (chunk 06)', () => {
  const readOrchestrator = () => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(
      path.join(__dirname, '../../services/whatsapp/whatsappTurnOrchestrator.service.ts'),
      'utf8',
    );
  };

  it('declares H6-H8 in cascade after H5 and before H9', () => {
    expect(BUYER_HANDLER_CASCADE.indexOf('H6')).toBeGreaterThan(BUYER_HANDLER_CASCADE.indexOf('H5'));
    expect(BUYER_HANDLER_CASCADE.indexOf('H7b')).toBeGreaterThan(BUYER_HANDLER_CASCADE.indexOf('H7'));
    expect(BUYER_HANDLER_CASCADE.indexOf('H8')).toBeGreaterThan(BUYER_HANDLER_CASCADE.indexOf('H7b'));
    expect(BUYER_HANDLER_CASCADE.indexOf('H9')).toBeGreaterThan(BUYER_HANDLER_CASCADE.indexOf('H8'));
  });

  it('H6 skips when visitCommit is already committed', () => {
    const content = readOrchestrator();
    const block = content.slice(
      content.indexOf('async function handleVisitCommitWorkflowTurn'),
      content.indexOf('// H7: Classifier workflow'),
    );
    expect(block).toContain('if (visitCommit.committed || !visitCommit.workflowSuggestion) return null');
  });

  it('H7 skips committed turns and interactive replies', () => {
    const content = readOrchestrator();
    const block = content.slice(
      content.indexOf('async function handleClassifierWorkflowTurn'),
      content.indexOf('// H8: Visit commit reply'),
    );
    expect(block).toContain('if (visitCommit.committed) return null');
    expect(block).toContain('if (ctx.input.interactiveId?.trim()) return null');
  });

  it('H7b asks for datetime before H8/H9 when visit action has no commit', () => {
    const content = readOrchestrator();
    const start = content.indexOf('const h7 = await handleClassifierWorkflowTurn');
    const end = content.indexOf(
      'return handleFullAiTurn(ctx, visitCommit, callCommit, liveCtx, conversationState);',
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = content.slice(start, end);
    expect(body).toContain('isVisitActionRequest(ctx.input.messageText)');
    expect(body).toContain('buyerMessageHasResolvableVisitDateTime');
    expect(body).toContain("stage: 'visit_booking'");
    expect(body).toContain('const h8 = await handleVisitCommitReplyTurn');
    expect(body.indexOf('buyerMessageHasResolvableVisitDateTime')).toBeLessThan(
      body.indexOf('const h8 = await handleVisitCommitReplyTurn'),
    );
  });

  it('H8 logs customerVisitBooked for scheduled commits', () => {
    const content = readOrchestrator();
    const block = content.slice(
      content.indexOf('async function handleVisitCommitReplyTurn'),
      content.indexOf('// H9: Full AI brain'),
    );
    expect(block).toContain("'customerVisitBooked'");
    expect(block).toContain("'visit_pending_approval'");
    expect(block).toContain("visitCommit.leadStatus === 'visit_scheduled'");
  });
});

describe('whatsappTurnOrchestrator handlers (chunk 07)', () => {
  const readOrchestrator = () => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(
      path.join(__dirname, '../../services/whatsapp/whatsappTurnOrchestrator.service.ts'),
      'utf8',
    );
  };

  it('H9 uses 28s Promise.race timeout with safe fallback', () => {
    const block = readOrchestrator().slice(
      readOrchestrator().indexOf('async function handleFullAiTurn'),
      readOrchestrator().indexOf('// Private helpers'),
    );
    expect(block).toContain('28_000');
    expect(block).toContain('buildSafeBuyerFallback');
    expect(block).toContain('H9 AI response timed out or failed');
  });

  it('H9 applies applyVisitMutationFromChat safety net before sanitize', () => {
    const content = readOrchestrator();
    const start = content.indexOf('async function handleFullAiTurn(');
    const end = content.indexOf('let outboundText = await sanitizeBuyerOutbound', start);
    const block = content.slice(start, end);
    expect(block.length).toBeGreaterThan(100);
    expect(block).toContain('applyVisitMutationFromChat');
    expect(block).toContain('!visitCommit.committed');
  });

  it('H9 escalation keeps ai_active and notifies agents only', () => {
    const block = readOrchestrator().slice(
      readOrchestrator().indexOf('async function persistNewConversationState'),
      readOrchestrator().indexOf('function fireMemoryExtraction'),
    );
    expect(block).toContain("status: 'ai_active'");
    expect(block).toContain('aiEnabled: true');
    expect(block).not.toContain("status: 'agent_active'");
    expect(block).toContain('notifyBuyerAgentAssistNeeded');
    expect(block).toContain('isAllowedStageTransition');
  });
});

describe('whatsappTurnOrchestrator handlers (chunk 09)', () => {
  const readOrchestrator = () => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(
      path.join(__dirname, '../../services/whatsapp/whatsappTurnOrchestrator.service.ts'),
      'utf8',
    );
  };

  it('declares callCommit and H-call before H3 in cascade', () => {
    expect(BUYER_HANDLER_CASCADE.indexOf('callCommit')).toBeGreaterThan(BUYER_HANDLER_CASCADE.indexOf('H2.5'));
    expect(BUYER_HANDLER_CASCADE.indexOf('H-call')).toBe(BUYER_HANDLER_CASCADE.indexOf('callCommit') + 1);
    expect(BUYER_HANDLER_CASCADE.indexOf('H3')).toBeGreaterThan(BUYER_HANDLER_CASCADE.indexOf('H-call'));
  });

  it('H-call uses hasActiveCall from tryCommitCustomerCallBooking', () => {
    const block = readOrchestrator().slice(
      readOrchestrator().indexOf('async function handleCallCommitReplyTurn'),
      readOrchestrator().indexOf('async function handleVisitStatusTurn'),
    );
    expect(block).toContain("logOutboundBranch('H-call'");
    expect(block).toContain('callCommit.hasActiveCall');
    expect(block).toContain('ctx.input.conversationStage');
    expect(block).not.toContain('hasActiveCall: true,');
  });

  it('H-call defers to visit commit when visit booking already committed', () => {
    const block = readOrchestrator().slice(
      readOrchestrator().indexOf('async function handleCallCommitReplyTurn'),
      readOrchestrator().indexOf('async function handleVisitStatusTurn'),
    );
    expect(block).toContain('if (visitCommit.committed) return null');
  });

  it('orchestrator invokes tryCommitCustomerCallBooking before H-call handler', () => {
    const body = readOrchestrator().slice(
      readOrchestrator().indexOf('export async function orchestrateWhatsAppBuyerTurn'),
      readOrchestrator().indexOf('function withDefaultReplyPacing'),
    );
    expect(body.indexOf('tryCommitCustomerCallBooking')).toBeLessThan(body.indexOf('handleCallCommitReplyTurn'));
    expect(body).toContain('interactiveId: ctx.input.interactiveId');
  });
});
