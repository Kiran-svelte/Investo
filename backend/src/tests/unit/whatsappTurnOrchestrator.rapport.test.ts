/// <reference types="jest" />

import {
  buildBuyerRapportTurnResult,
  isPropertyBrowsingIntent,
  orchestrateWhatsAppBuyerTurn,
} from '../../services/whatsapp/whatsappTurnOrchestrator.service';
import { resolveBuyerComponents } from '../../services/buyer/buyerButtonPolicy.service';
import { computeHasPriorOutbound } from '../../services/buyer/buyerSession.util';
import {
  buildReturningBuyerPivotReply,
  isReturningBuyerPivotReply,
} from '../../services/buyerQualification.service';
import type { ConversationState } from '../../services/conversationStateMachine';
import { conversationStateManager } from '../../services/conversationStateMachine';

const mockPrismaMessageCreate = jest.fn().mockResolvedValue({});
const mockPrismaConversationUpdate = jest.fn().mockResolvedValue({});
const mockRunWorkflow = jest.fn();
const mockClassifyAndRunBuyerWorkflow = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    message: {
      create: (...args: unknown[]) => mockPrismaMessageCreate(...args),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    conversation: {
      update: (...args: unknown[]) => mockPrismaConversationUpdate(...args),
    },
    notification: { create: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    aiSetting: { findUnique: jest.fn() },
    lead: { update: jest.fn() },
    visit: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../services/customerVisitBooking.service', () => ({
  tryCommitCustomerVisitBooking: jest.fn().mockResolvedValue({
    committed: false,
    workflowSuggestion: null,
  }),
}));

jest.mock('../../services/customerCallBooking.service', () => ({
  tryCommitCustomerCallBooking: jest.fn().mockResolvedValue({
    committed: false,
    customerReply: null,
  }),
}));

jest.mock('../../services/liveLeadContext.service', () => ({
  getLiveLeadContext: jest.fn().mockResolvedValue({ activeVisit: null }),
}));

jest.mock('../../services/workflow/workflow-engine.service', () => ({
  runWorkflow: (...args: unknown[]) => mockRunWorkflow(...args),
  classifyAndRunBuyerWorkflow: (...args: unknown[]) => mockClassifyAndRunBuyerWorkflow(...args),
}));

jest.mock('../../services/buyer/buyerStartFresh.service', () => ({
  isBuyerStartCommand: jest.fn().mockReturnValue(false),
  buildBuyerStartFreshReply: jest.fn(),
  resetBuyerBookingAndConversationState: jest.fn(),
}));

function baseConversationState(stage = 'rapport'): ConversationState {
  const state = conversationStateManager.createInitialState();
  if (stage !== 'rapport') {
    state.stage = stage as ConversationState['stage'];
  }
  return state;
}

function baseTurnCtx(overrides: {
  messageText: string;
  history?: Array<{ senderType: string; content: string; createdAt: Date }>;
  stage?: string;
}) {
  const history = overrides.history ?? [];
  return {
    input: {
      companyId: 'co-1',
      customerPhone: '+919876543210',
      messageId: 'msg-1',
      messageText: overrides.messageText,
      companyName: 'Palm Realty',
      leadId: 'lead-1',
      leadStatus: 'new',
      leadAssignedAgentId: null,
      leadCustomerName: 'Raj',
      leadLanguage: 'en',
      conversationId: 'conv-1',
      conversationSelectedPropertyId: null,
      conversationProposedVisitTime: null,
      conversationRecommendedPropertyIds: [],
      conversationStage: overrides.stage ?? 'rapport',
      humanTakeover: false,
      history,
      hasPriorOutbound: computeHasPriorOutbound(history),
    },
    companyId: 'co-1',
    customerPhone: '+919876543210',
    messageId: 'msg-1',
    companyName: 'Palm Realty',
    whatsappConfig: {} as never,
    history,
  };
}

describe('whatsappTurnOrchestrator rapport handlers (chunk 04 H2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('first-time Hi includes rapport filter buttons per full.md PART XVI', async () => {
    const result = await buildBuyerRapportTurnResult({
      companyName: 'Palm Realty',
      messageText: 'Hi',
      hasPriorOutbound: false,
      stage: 'rapport',
    });
    expect(result?.handled).toBe(true);
    expect(result?.text).toContain('Welcome to *Palm Realty*');

    const buttons = result?.components?.[0];
    expect(buttons?.kind).toBe('buttons');
    if (buttons?.kind === 'buttons') {
      const ids = buttons.buttons.map((b) => b.id);
      expect(ids).toEqual(expect.arrayContaining(['filter-apartment', 'filter-villa', 'call-me']));
    }
  });

  test('returning Hi has zero components (isReturningGreeting policy)', async () => {
    const result = await buildBuyerRapportTurnResult({
      companyName: 'Palm Realty',
      messageText: 'Hello',
      hasPriorOutbound: true,
      stage: 'rapport',
      locationPreference: 'Whitefield',
    });
    expect(result?.text).toContain('Welcome back');
    expect(result?.components).toEqual([]);
    expect(
      resolveBuyerComponents({
        stage: 'rapport',
        outboundText: result!.text,
        isReturningGreeting: true,
      }),
    ).toEqual([]);
  });

  test('handleRapportTurn skips mid-booking stages (source proof)', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../services/whatsapp/whatsappTurnOrchestrator.service.ts'),
      'utf8',
    );
    expect(content).toMatch(
      /if \(\['visit_booking', 'confirmation', 'commitment'\]\.includes\(conversationStage\)\) return null/,
    );
  });

  test('H2 uses computeHasPriorOutbound from buyerSession.util (source proof)', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../services/whatsapp/whatsappTurnOrchestrator.service.ts'),
      'utf8',
    );
    const h2Block = content.slice(
      content.indexOf('async function handleRapportTurn'),
      content.indexOf('async function handleReturningBuyerPivotTurn'),
    );
    expect(h2Block).toContain('computeHasPriorOutbound(ctx.history)');
    expect(h2Block).not.toMatch(/history\.some\(/);
  });
});

describe('whatsappTurnOrchestrator returning pivot (chunk 04 H2b)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('isReturningBuyerPivotReply detects pivot phrases', () => {
    expect(isReturningBuyerPivotReply('Something new')).toBe(true);
    expect(isReturningBuyerPivotReply('new search')).toBe(true);
    expect(isReturningBuyerPivotReply('3 BHK Whitefield')).toBe(false);
    expect(buildReturningBuyerPivotReply('Palm Realty')).toContain('start fresh');
  });

  test('H2b resets conversation to qualify with cleared property selection', async () => {
    const history = [{ senderType: 'ai', content: 'Welcome back!', createdAt: new Date() }];
    const ctx = baseTurnCtx({ messageText: 'Something new', history });
    const result = await orchestrateWhatsAppBuyerTurn(ctx, baseConversationState('shortlist'));

    expect(result.handled).toBe(true);
    expect(result.text).toContain('start fresh');
    expect(mockPrismaConversationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-1' },
        data: expect.objectContaining({
          stage: 'qualify',
          selectedPropertyId: null,
          recommendedPropertyIds: [],
        }),
      }),
    );
  });
});

describe('whatsappTurnOrchestrator property browse (chunk 04 H2.5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunWorkflow.mockResolvedValue({ reply: 'Here are 3 matching projects in Whitefield.' });
  });

  test('isPropertyBrowsingIntent matches browse phrases', () => {
    expect(isPropertyBrowsingIntent('property')).toBe(true);
    expect(isPropertyBrowsingIntent('show me properties')).toBe(true);
    expect(isPropertyBrowsingIntent('what properties do you have')).toBe(true);
    expect(isPropertyBrowsingIntent('available apartments')).toBe(true);
  });

  test('isPropertyBrowsingIntent negative guards: book, visit, price, brochure, discount', () => {
    expect(isPropertyBrowsingIntent('book a visit')).toBe(false);
    expect(isPropertyBrowsingIntent('schedule visit tomorrow')).toBe(false);
    expect(isPropertyBrowsingIntent('what is the price')).toBe(false);
    expect(isPropertyBrowsingIntent('send brochure')).toBe(false);
    expect(isPropertyBrowsingIntent('any discount')).toBe(false);
    expect(isPropertyBrowsingIntent('call me')).toBe(false);
  });

  test('H2.5 calls runWorkflow(availability_check) not classifyAndRunBuyerWorkflow', async () => {
    const ctx = baseTurnCtx({ messageText: 'show me properties' });
    const result = await orchestrateWhatsAppBuyerTurn(ctx, baseConversationState());

    expect(result.handled).toBe(true);
    expect(result.text).toContain('matching projects');
    expect(mockRunWorkflow).toHaveBeenCalledWith(
      'availability_check',
      expect.objectContaining({
        channel: 'buyer',
        sessionLeadId: 'lead-1',
      }),
      expect.objectContaining({ leadId: 'lead-1' }),
    );
    expect(mockClassifyAndRunBuyerWorkflow).not.toHaveBeenCalled();
  });

  test('H2.5 runs before H7 classifier (source proof)', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../services/whatsapp/whatsappTurnOrchestrator.service.ts'),
      'utf8',
    );
    const start = content.indexOf('export async function orchestrateWhatsAppBuyerTurn');
    const body = content.slice(start, start + 4500);
    expect(body.indexOf('handlePropertyBrowsingTurn')).toBeLessThan(
      body.indexOf('handleClassifierWorkflowTurn'),
    );
    const h25Block = content.slice(
      content.indexOf('async function handlePropertyBrowsingTurn'),
      content.indexOf('async function handleMemoryRecallTurn'),
    );
    expect(h25Block).toContain("runWorkflow('availability_check'");
    expect(h25Block).toMatch(/const \{ runWorkflow \} = await import/);
    expect(h25Block).not.toMatch(/await classifyAndRunBuyerWorkflow\(/);
  });
});
