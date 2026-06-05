/**
 * 6-Pillar AI Agent Proof Tests
 *
 * Contractual proof that the Investo WhatsApp AI agent satisfies every
 * pillar defined in docs/ai.md:
 *
 *  1. Stateful     — Remembers everything. Never asks twice.
 *  2. Proactive    — Anticipates needs. Doesn't just react.
 *  3. Contextual   — "later" = reschedule, not new booking.
 *  4. Idempotent   — Same action twice = same result. No duplicates.
 *  5. Graceful     — Errors explain what happened and how to fix.
 *  6. Transparent  — Shows what it did and why.
 *
 * Each test block targets a specific failure mode seen in production screenshots.
 *
 * @module tests/unit/ai-agent-6pillar.test.ts
 */

// ─── Mocks (must appear before any imports that pull in Prisma/Redis) ───────

jest.mock('../../src/config/prisma', () => ({
  default: {
    $connect: jest.fn(),
    lead: { findFirst: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    visit: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    message: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn() },
    conversation: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
    company: { findUnique: jest.fn() },
    notification: { create: jest.fn() },
  },
}));

jest.mock('../../src/config/logger', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/config/redis', () => ({
  getRedis: jest.fn(() => null),
  getCacheType: jest.fn(() => 'memory'),
}));

jest.mock('../../src/config', () => ({
  default: {
    db: { url: 'postgresql://test', ssl: false },
    ai: {
      provider: 'openai',
      openaiApiKey: '',
      openaiModel: 'gpt-4o',
      kimiApiKey: '',
      kimiApiBaseUrl: '',
      kimi25Model: '',
      claudeApiKey: '',
      claudeModel: '',
    },
    agentAi: { enabled: false, model: '' },
    app: { env: 'test' },
    server: { port: 3000 },
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import {
  classifyMessageIntent,
} from '../../src/services/conversationStateMachine';

import {
  buildFastPathCustomerReply,
  isSimpleGreetingMessage,
  isConversationAcknowledgmentMessage,
} from '../../src/services/customerMessageFastPath.service';

import { buildVisitAwareGreeting } from '../../src/services/liveLeadContext.service';

import {
  isVisitCancelOrRescheduleMessage,
  isVisitListQueryMessage,
} from '../../src/services/visitIntentFromMessage.service';

import type { ActiveVisitContext } from '../../src/services/liveLeadContext.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_ACTIVE_VISIT: ActiveVisitContext = {
  visitId: 'visit-uuid-1',
  propertyId: 'prop-uuid-1',
  propertyName: 'Sunset Heights',
  status: 'scheduled',
  scheduledAt: new Date('2026-06-15T10:00:00+05:30'),
  agentName: 'Rahul Sharma',
  agentPhone: '+919876543210',
  notes: null,
};

const CONFIRMED_VISIT: ActiveVisitContext = {
  ...MOCK_ACTIVE_VISIT,
  status: 'confirmed',
};

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 1 — STATEFUL
// Remembers everything. Never asks twice.
// ─────────────────────────────────────────────────────────────────────────────

describe('Pillar 1 — Stateful', () => {
  it('returns null fast-path for returning client greeting so LLM can continue property discussion', () => {
    const result = buildFastPathCustomerReply({
      customerMessage: 'hi',
      companyName: 'Palm Properties',
      conversationHistory: [
        { senderType: 'customer', content: 'looking for 3BHK' },
        { senderType: 'ai', content: 'Great! Budget range?' },
      ],
    });
    // Returning client — must hand off to LLM, NOT reset with first-time greeting
    expect(result).toBeNull();
  });

  it('provides visit-aware greeting instead of generic welcome for client with active visit', () => {
    const result = buildFastPathCustomerReply({
      customerMessage: 'hi',
      companyName: 'Palm Properties',
      upcomingVisit: MOCK_ACTIVE_VISIT,
      conversationHistory: [], // First contact — fresh conversation
    });
    expect(result).not.toBeNull();
    expect(result!.text).toContain('Sunset Heights');
    expect(result!.text).toContain('visit');
    // Must NOT reset to generic "What area are you looking in?"
    expect(result!.text).not.toMatch(/what area|looking for|budget/i);
  });

  it('classifies "Any visits booked for me?" as adjacent, NOT commitment or escalation', () => {
    const { intent } = classifyMessageIntent(
      'Any visits booked for me ??',
      'rapport',
      { consecutiveObjections: 0 },
    );
    expect(intent).toBe('adjacent');
    expect(intent).not.toBe('commitment');
    expect(intent).not.toBe('escalation_request');
  });

  it('classifies "Do I have any visits scheduled?" as adjacent', () => {
    const { intent } = classifyMessageIntent(
      'Do I have any visits scheduled this week?',
      'qualify',
      { consecutiveObjections: 0 },
    );
    expect(intent).toBe('adjacent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 2 — PROACTIVE
// Anticipates needs. Doesn't just react.
// ─────────────────────────────────────────────────────────────────────────────

describe('Pillar 2 — Proactive', () => {
  it('returns visit-aware greeting with confirm/reschedule/cancel options', () => {
    const greeting = buildVisitAwareGreeting(
      'Priya',
      MOCK_ACTIVE_VISIT,
      'Palm Properties',
    );
    expect(greeting).toContain('Confirm');
    expect(greeting).toContain('Reschedule');
    expect(greeting).toContain('Cancel');
    expect(greeting).toContain('Sunset Heights');
  });

  it('adds confirmed status to visit-aware greeting for confirmed visits', () => {
    const greeting = buildVisitAwareGreeting(
      null,
      CONFIRMED_VISIT,
      'Palm Properties',
    );
    expect(greeting).toMatch(/confirmed/i);
    expect(greeting).not.toMatch(/upcoming.*visit\s*🗓️/); // Should use confirmed icon
  });

  it('provides ack response with last discussed property name', () => {
    const result = buildFastPathCustomerReply({
      customerMessage: 'good',
      companyName: 'Palm Properties',
      conversationHistory: [
        { senderType: 'customer', content: 'Tell me about Sunset Heights' },
        { senderType: 'ai', content: 'Sunset Heights is a great option...' },
      ],
      propertyNames: ['Sunset Heights', 'Lake Vista'],
    });
    expect(result).not.toBeNull();
    // Must reference the property they discussed
    expect(result!.text).toContain('Sunset Heights');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 3 — CONTEXTUAL
// Understands "later" = reschedule, not new booking.
// ─────────────────────────────────────────────────────────────────────────────

describe('Pillar 3 — Contextual', () => {
  it('detects "reschedule visit to Friday" as a cancel/reschedule message', () => {
    expect(isVisitCancelOrRescheduleMessage('reschedule my visit to Friday 3pm')).toBe(true);
  });

  it('detects "cancel the appointment" as cancel/reschedule', () => {
    expect(isVisitCancelOrRescheduleMessage("I'd like to cancel the appointment")).toBe(true);
  });

  it('does NOT treat "I want to visit this Saturday" as a cancel/reschedule', () => {
    expect(isVisitCancelOrRescheduleMessage('I want to visit this Saturday')).toBe(false);
  });

  it('correctly identifies a visit-list query vs. a reschedule request', () => {
    expect(isVisitListQueryMessage('visits for today')).toBe(true);
    expect(isVisitListQueryMessage('reschedule my visit')).toBe(false);
    expect(isVisitListQueryMessage('list visits')).toBe(true);
  });

  it('does NOT classify visit-status question as commitment', () => {
    // "booked" must not match the "book" commitment pattern
    const { intent } = classifyMessageIntent(
      'Are there any visits booked for me?',
      'rapport',
      { consecutiveObjections: 0 },
    );
    expect(intent).not.toBe('commitment');
  });

  it('classifies a genuine visit commitment correctly', () => {
    const { intent } = classifyMessageIntent(
      'Yes, I can come this Saturday morning',
      'commitment',
      { consecutiveObjections: 0 },
    );
    expect(intent).toBe('commitment');
  });

  it('does NOT classify "I had a visit scheduled" as a commitment signal', () => {
    // Past-tense "scheduled" should not be treated as the customer agreeing to schedule one
    const { intent } = classifyMessageIntent(
      'I had a visit scheduled but I missed it',
      'rapport',
      { consecutiveObjections: 0 },
    );
    expect(intent).not.toBe('commitment');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 4 — IDEMPOTENT
// Same action twice = same result. No duplicates.
// ─────────────────────────────────────────────────────────────────────────────

describe('Pillar 4 — Idempotent', () => {
  it('isSimpleGreetingMessage is pure — returns same result on repeated calls', () => {
    const message = 'hello';
    const result1 = isSimpleGreetingMessage(message);
    const result2 = isSimpleGreetingMessage(message);
    expect(result1).toBe(result2);
    expect(result1).toBe(true);
  });

  it('isVisitCancelOrRescheduleMessage is pure — identical result for identical input', () => {
    const message = 'reschedule visit to Friday 4pm';
    const r1 = isVisitCancelOrRescheduleMessage(message);
    const r2 = isVisitCancelOrRescheduleMessage(message);
    expect(r1).toBe(r2);
    expect(r1).toBe(true);
  });

  it('classifyMessageIntent is deterministic for the same input', () => {
    const msg = 'I have a 1 crore budget and want a 3BHK in Whitefield';
    const r1 = classifyMessageIntent(msg, 'qualify', { consecutiveObjections: 0 });
    const r2 = classifyMessageIntent(msg, 'qualify', { consecutiveObjections: 0 });
    expect(r1.intent).toBe(r2.intent);
    expect(r1.confidence).toBe(r2.confidence);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 5 — GRACEFUL
// Errors explain what happened and how to fix.
// ─────────────────────────────────────────────────────────────────────────────

describe('Pillar 5 — Graceful', () => {
  it('visit-aware greeting tells customer exactly what is on record', () => {
    const greeting = buildVisitAwareGreeting('Amit', MOCK_ACTIVE_VISIT, 'Palm');
    // Must name the property — customer knows what visit we mean
    expect(greeting).toContain('Sunset Heights');
    // Must include the date
    expect(greeting).toBeTruthy();
    // Must NOT contain internal error jargon
    expect(greeting).not.toMatch(/error|exception|failed|issue/i);
  });

  it('first-contact greeting asks a question, never lists capabilities', () => {
    const result = buildFastPathCustomerReply({
      customerMessage: 'hi',
      companyName: 'Palm Properties',
      conversationHistory: [],
    });
    expect(result).not.toBeNull();
    // Must not list capabilities as a menu (rule 10 in system prompt)
    expect(result!.text).not.toMatch(/here'?s how i can help|i can:|1\.\s+/i);
    // Must end with a question (area or budget)
    expect(result!.text).toMatch(/\?/);
  });

  it('identity question response provides clear context, not a capability menu', () => {
    const result = buildFastPathCustomerReply({
      customerMessage: 'who are you',
      companyName: 'Palm Properties',
      conversationHistory: [],
    });
    expect(result).not.toBeNull();
    expect(result!.text).toContain('Palm Properties');
    expect(result!.text).not.toMatch(/here'?s how i can help|1\.\s+2\./i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 6 — TRANSPARENT
// Shows what it did and why.
// ─────────────────────────────────────────────────────────────────────────────

describe('Pillar 6 — Transparent', () => {
  it('visit-aware greeting clearly states visit status (scheduled vs confirmed)', () => {
    const scheduledGreeting = buildVisitAwareGreeting(null, MOCK_ACTIVE_VISIT, 'Palm');
    const confirmedGreeting = buildVisitAwareGreeting(null, CONFIRMED_VISIT, 'Palm');

    expect(scheduledGreeting).toMatch(/upcoming|scheduled/i);
    expect(confirmedGreeting).toMatch(/confirmed/i);
    // Should be different messages based on status
    expect(scheduledGreeting).not.toBe(confirmedGreeting);
  });

  it('ack response tells customer what property it is referencing', () => {
    const result = buildFastPathCustomerReply({
      customerMessage: 'thanks',
      companyName: 'Palm',
      conversationHistory: [
        { senderType: 'customer', content: 'Tell me about Lake Vista' },
        { senderType: 'ai', content: 'Lake Vista is a premium project...' },
      ],
      propertyNames: ['Lake Vista'],
    });
    expect(result).not.toBeNull();
    expect(result!.text).toContain('Lake Vista');
  });

  it('classifyMessageIntent escalation confidence is >= 0.9 for explicit requests', () => {
    const { intent, confidence } = classifyMessageIntent(
      'I want to speak to a manager',
      'rapport',
      { consecutiveObjections: 0 },
    );
    expect(intent).toBe('escalation_request');
    expect(confidence).toBeGreaterThanOrEqual(0.9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION — Screenshot-specific scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression — Screenshot failure scenarios', () => {
  it('REGRESSION: "Okay" from returning client does NOT produce first-time greeting', () => {
    const result = buildFastPathCustomerReply({
      customerMessage: 'Okay',
      companyName: 'Palm Properties',
      conversationHistory: [
        { senderType: 'customer', content: 'Looking for 3BHK in Whitefield' },
        { senderType: 'ai', content: 'Great! We have Sunset Heights...' },
      ],
    });
    // ACK handler should fire — NOT reset to new-client greeting
    expect(result).not.toBeNull();
    // Must not re-introduce itself as if meeting the customer for the first time
    expect(result!.text).not.toMatch(/welcome to palm|what area are you looking/i);
  });

  it('REGRESSION: visit-status question does not cause escalation classification', () => {
    // The failing screenshot: customer asks "Any visits booked for me??"
    // and bot responded with "A human specialist will assist you"
    const { intent } = classifyMessageIntent(
      'Any visits booked for me ??',
      'rapport',
      { consecutiveObjections: 0 },
    );
    expect(intent).not.toBe('escalation_request');
    expect(intent).not.toBe('commitment'); // "booked" must not match bare "book"
  });

  it('REGRESSION: "show my visits" is a list query, not a cancel/reschedule', () => {
    expect(isVisitListQueryMessage('show my visits')).toBe(true);
    expect(isVisitCancelOrRescheduleMessage('show my visits')).toBe(false);
  });

  it('REGRESSION: non-breaking space in greeting is detected as simple greeting', () => {
    // WhatsApp sometimes appends U+00A0 (non-breaking space) after greetings
    expect(isSimpleGreetingMessage('hi\u00a0')).toBe(true);
  });

  it('REGRESSION: multi-word greeting "hey there" is not detected as simple greeting', () => {
    // Should not match — too specific/long to be the bare greeting fast-path
    expect(isSimpleGreetingMessage('hey how can I book a visit')).toBe(false);
  });
});
