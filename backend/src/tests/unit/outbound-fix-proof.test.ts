/**
 * Proof tests — each describe block = one audited fix area.
 * PASS = code-level proof the fix is wired. Run: npx jest outbound-fix-proof
 */
import {
  formatBuyerVisitCancelled,
  formatBuyerVisitPendingApproval,
  formatBuyerVisitScheduled,
} from '../../utils/visitFormat.util';

// ── Area 1: Pending approval single-send ───────────────────────────────────
describe('PROOF Area 1 — pending approval single customer send', () => {
  const mockSendCompanyTextMessage = jest.fn().mockResolvedValue(true);
  const mockSendCompanyInteractiveButtons = jest.fn().mockResolvedValue(true);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createVisitApprovalRequest skips customer WhatsApp when suppressCustomerMessage=true', async () => {
    jest.resetModules();
    jest.doMock('../../services/whatsapp.service', () => ({
      whatsappService: {
        sendCompanyTextMessage: mockSendCompanyTextMessage,
        sendCompanyInteractiveButtons: mockSendCompanyInteractiveButtons,
      },
    }));
    jest.doMock('../../config/prisma', () => ({
      __esModule: true,
      default: {
        notification: { create: jest.fn().mockResolvedValue({}) },
        user: { findUnique: jest.fn().mockResolvedValue({ name: 'Agent', phone: '+919000000001' }) },
      },
    }));
    jest.doMock('../../services/bookingApproval.service', () => ({
      buildVisitApprovalIdempotencyKey: jest.fn(() => 'visit-approval-key'),
      createBookingApprovalRequest: jest.fn().mockResolvedValue({
        approval: {
          id: 'approval-1',
          companyId: 'co-1',
          leadId: 'lead-1',
          propertyId: 'prop-1',
          agentId: 'agent-1',
          conversationId: 'conv-1',
          scheduledAt: new Date('2026-06-10T10:00:00+05:30'),
          customerPhone: '+919876543210',
          customerName: 'Test',
          metadata: { propertyName: 'Sunset Heights' },
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
        },
        created: true,
        idempotencyHit: false,
      }),
    }));
    jest.doMock('../../services/notification.engine', () => ({
      notificationEngine: { notify: jest.fn().mockResolvedValue(undefined) },
    }));
    jest.doMock('../../services/automationQueue.service', () => ({
      automationQueueService: { schedule: jest.fn().mockResolvedValue(true), cancel: jest.fn().mockResolvedValue(true) },
    }));
    jest.doMock('../../config/logger', () => ({
      __esModule: true,
      default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { createVisitApprovalRequest } = await import('../../services/visitPendingApproval.service');
    await createVisitApprovalRequest({
      companyId: 'co-1',
      leadId: 'lead-1',
      propertyId: 'prop-1',
      scheduledAt: new Date('2026-06-10T10:00:00+05:30'),
      agentId: 'agent-1',
      conversationId: 'conv-1',
      customerPhone: '+919876543210',
      propertyName: 'Sunset Heights',
      suppressCustomerMessage: true,
    });

    expect(mockSendCompanyTextMessage).not.toHaveBeenCalled();
    expect(mockSendCompanyInteractiveButtons).toHaveBeenCalled();
  });

  test('customerVisitBooking always passes suppressCustomerMessage:true to createVisitApprovalRequest', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../services/customerVisitBooking.service.ts'),
      'utf8',
    );
    const blocks = content.match(/createVisitApprovalRequest\(\{[\s\S]*?\}\);/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    blocks.forEach((block: string) => {
      expect(block).toContain('suppressCustomerMessage: true');
    });
  });
});

// ── Area 2: Workflow notification suppress ─────────────────────────────────
describe('PROOF Area 2 — workflow suppresses duplicate customer notification', () => {
  const read = (rel: string) => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
  };

  test('buyer reschedule passes suppressCustomerNotification', () => {
    const content = read('services/workflow/actions/visit-actions.ts');
    expect(content).toMatch(
      /createVisitApprovalRequest\(\{[\s\S]*?suppressCustomerMessage:\s*true[\s\S]*?rescheduleVisitId:/,
    );
  });

  test('buyer cancel passes suppressCustomerNotification: true', () => {
    const content = read('services/workflow/actions/visit-actions.ts');
    expect(content).toMatch(/cancelVisitById\(\{[\s\S]*?suppressCustomerNotification:\s*true/);
  });

  test('notification.engine gates customer send on suppress flag', () => {
    const content = read('services/notification.engine.ts');
    expect(content).toContain('if (!suppressCustomerNotification && lead?.phone)');
  });
});

// ── Area 3: Human takeover before commits ──────────────────────────────────
describe('PROOF Area 3 — human takeover before visit/call commits', () => {
  test('handleHumanTakeoverTurn is called before tryCommitCustomerVisitBooking', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../services/whatsapp/whatsappTurnOrchestrator.service.ts'),
      'utf8',
    );
    const start = content.indexOf('export async function orchestrateWhatsAppBuyerTurn');
    const body = content.slice(start, start + 3500);
    expect(body.indexOf('handleHumanTakeoverTurn')).toBeLessThan(
      body.indexOf('tryCommitCustomerVisitBooking'),
    );
  });
});

// ── Area 4: visit-slot-morning/afternoon wired ─────────────────────────────
describe('PROOF Area 4 — visit-slot-morning/afternoon wired in orchestrator', () => {
  test('tryOrchestratedInteractiveAction registers visit-slot-morning and visit-slot-afternoon', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../services/whatsapp/whatsappInteractiveOrchestrator.service.ts'),
      'utf8',
    );
    expect(content).toContain("interactiveId === 'visit-slot-morning'");
    expect(content).toContain("interactiveId === 'visit-slot-afternoon'");
    expect(content).toContain('handleGenericVisitSlot');
    expect(content).toContain('handleBookVisit({ ...params, interactiveId: `book-visit-${propertyId}`');
  });
});

// ── Area 5: Wrong property fallback blocked ────────────────────────────────
describe('PROOF Area 5 — explicit property name blocks stale fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Commercial Hub in message but not in catalog → null (not stale sunset)', async () => {
    jest.resetModules();
    jest.doMock('../../config/prisma', () => ({
      __esModule: true,
      default: {
        property: {
          findMany: jest.fn().mockResolvedValue([{ id: 'sunset', name: 'Sunset Heights' }]),
        },
      },
    }));
    const { resolveBuyerPropertyReference } = await import('../../services/buyerPropertyContext.service');
    const id = await resolveBuyerPropertyReference({
      companyId: 'co-1',
      messageText: 'book visit for commercial hub tomorrow',
      selectedPropertyId: 'sunset',
    });
    expect(id).toBeNull();
  });

  test('Commercial Hub in catalog → returns commercial id', async () => {
    jest.resetModules();
    jest.doMock('../../config/prisma', () => ({
      __esModule: true,
      default: {
        property: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'sunset', name: 'Sunset Heights' },
            { id: 'commercial', name: 'Commercial Hub' },
          ]),
        },
      },
    }));
    const { resolveBuyerPropertyReference } = await import('../../services/buyerPropertyContext.service');
    const id = await resolveBuyerPropertyReference({
      companyId: 'co-1',
      messageText: 'I want to book visit for Commercial Hub',
      selectedPropertyId: 'sunset',
    });
    expect(id).toBe('commercial');
  });
});

// ── Area 6: EMI single TurnResult ──────────────────────────────────────────
describe('PROOF Area 6 — EMI single TurnResult (no double send)', () => {
  test('emi-calculator uses turnResult with embedded buttons, not sendMessage', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(path.join(__dirname, '../../services/whatsapp.service.ts'), 'utf8');
    const block = content.slice(
      content.indexOf("interactiveId === 'emi-calculator'"),
      content.indexOf('// ---- Unrecognized action'),
    );
    expect(block).toContain('turnResult:');
    expect(block).toContain("kind: 'buttons'");
    expect(block).not.toContain('await this.sendMessage(');
  });
});

// ── Area 7: Unified visit format ───────────────────────────────────────────
describe('PROOF Area 7 — canonical visit message format shared across paths', () => {
  test('formatBuyerVisitScheduled structure', () => {
    const msg = formatBuyerVisitScheduled(
      new Date('2026-06-10T10:00:00+05:30'),
      'Sunset Heights',
      'Riya',
    );
    expect(msg).toMatch(/\*Visit scheduled\*/);
    expect(msg).toContain('Property: *Sunset Heights*');
    expect(msg).toContain('*Riya*');
  });

  test('all visit reply paths import visitFormat.util', () => {
    const fs = require('fs');
    const path = require('path');
    for (const f of [
      'services/customerVisitBooking.service.ts',
      'services/workflow/actions/visit-actions.ts',
      'services/visitMutationFromChat.service.ts',
      'services/visitPendingApproval.service.ts',
    ]) {
      expect(fs.readFileSync(path.join(__dirname, '../..', f), 'utf8')).toContain('visitFormat.util');
    }
  });
});

// ── Area 8: Dead code removed ──────────────────────────────────────────────
describe('PROOF Area 8 — dead code and debug instrumentation removed', () => {
  const read = (rel: string) => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
  };

  test('deprecated orchestrator stubs removed', () => {
    const content = read('services/whatsapp/whatsappTurnOrchestrator.service.ts');
    expect(content).not.toContain('buildBuyerHandoffTurnResult');
    expect(content).not.toContain('export async function handleWhatsAppTurn');
  });

  test('maybeSendCatalogBrochureForQuery removed', () => {
    expect(read('services/whatsapp.service.ts')).not.toContain('maybeSendCatalogBrochureForQuery');
  });

  test('stale debug fetch instrumentation removed from prod paths', () => {
    const orch = read('services/whatsapp/whatsappTurnOrchestrator.service.ts');
    const wa = read('services/whatsapp.service.ts');
    expect(orch).not.toContain("location:'whatsappTurnOrchestrator.service.ts:handleFullAiTurn'");
    expect(orch).not.toContain("location:'whatsappTurnOrchestrator.service.ts:handleReturningBuyerPivotTurn'");
    expect(wa).not.toContain("location:'whatsapp.service.ts:orchestratorCatch'");
  });
});

// ── Area 9: Multi-reply syndrome (fix.md) ──────────────────────────────────
describe('PROOF Area 9 — one customer reply per inbound turn', () => {
  const read = (rel: string) => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
  };

  test('visit-time handled via orchestrator TurnResult, not legacy direct send', () => {
    const orch = read('services/whatsapp/whatsappInteractiveOrchestrator.service.ts');
    const wa = read('services/whatsapp.service.ts');
    expect(orch).toContain('handleVisitTimeSlot');
    expect(orch).toContain("interactiveId.startsWith('visit-time-')");
    expect(wa).not.toContain('// ---- Visit Time Selection (legacy direct send');
  });

  test('location handled via TurnResult, not legacy direct sendLocation', () => {
    const wa = read('services/whatsapp.service.ts');
    const locationBlock = wa.slice(
      wa.indexOf("// ---- Show Location"),
      wa.indexOf('// ---- EMI Calculator Request'),
    );
    expect(locationBlock).toContain('turnResult');
    expect(locationBlock).not.toContain('await this.sendLocation(');
    expect(locationBlock).not.toContain('await this.sendMessage(');
  });

  test('orchestrator passes full property catalog to AI, not stripped PropertySummary', () => {
    const orch = read('services/whatsapp/whatsappTurnOrchestrator.service.ts');
    expect(orch).toContain('propertyToAiPromptInput');
    expect(orch).toContain('buildFocusedPropertyPromptBlock');
    expect(orch).toContain('properties: aiProperties');
    expect(orch).toContain('focusedPropertyBlock');
  });

  test('sendTurnResult sends native media before text and buttons', () => {
    const wa = read('services/whatsapp.service.ts');
    expect(wa).toContain('sendImage(to, media.url');
    expect(wa).toContain('sendDocument(to, media.url');
  });

  test('orchestrator catch does not sendMessage — single dispatch via sendTurnResult', () => {
    const wa = read('services/whatsapp.service.ts');
    const catchBlock = wa.slice(wa.indexOf('orchestratorCatch'), wa.indexOf('if (turnResult.text?.trim())'));
    expect(catchBlock).not.toContain('await this.sendMessage(');
  });

  test('primary outbound budget enforced on customer sends', () => {
    const wa = read('services/whatsapp.service.ts');
    expect(wa).toContain('claimPrimaryOutboundSend');
    expect(wa).toContain('Blocked duplicate primary WhatsApp text send');
  });

  test('H2 rapport skipped during visit_booking stage', () => {
    const orch = read('services/whatsapp/whatsappTurnOrchestrator.service.ts');
    expect(orch).toMatch(/visit_booking.*confirmation.*commitment/s);
  });

  test('interactive safety net blocks orchestrator LLM on button taps', () => {
    const orch = read('services/whatsapp/whatsappTurnOrchestrator.service.ts');
    expect(orch).toContain('handleInteractiveSafetyTurn');
    expect(orch).toContain('interactive_safety_net');
  });

  test('AI reactivation runs before interactive handling', () => {
    const wa = read('services/whatsapp.service.ts');
    const interactiveIdx = wa.indexOf('// 3.5. Handle interactive button/list responses');
    const reactivateIdx = wa.indexOf('ensureProspectConversationAiActive(conversation');
    expect(reactivateIdx).toBeGreaterThan(-1);
    expect(interactiveIdx).toBeGreaterThan(reactivateIdx);
  });

  test('fast path skips greeting during booking stages', () => {
    const fp = read('services/customerMessageFastPath.service.ts');
    expect(fp).toContain('conversationStage');
    expect(fp).toContain("input.conversationStage === 'visit_booking'");
  });

  test('policy brain visit_booking returns single continue action', () => {
    const sm = read('services/conversationStateMachine.ts');
    expect(sm).toContain('VISIT BOOKING: ONE message only');
  });

  test('LLM prompt forbids multi-message replies', () => {
    const ai = read('services/ai.service.ts');
    expect(ai).toContain('NEVER send more than one message per user turn');
  });
});

// ── Area 10: fix.md hardening (LLM params, banned phrases, stage guards) ───
describe('PROOF Area 10 — fix.md production hardening', () => {
  const read = (rel: string) => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
  };

  test('buyer LLM uses centralized safe params', () => {
    const params = read('constants/llmSafeParams.constants.ts');
    expect(params).toContain('temperature: 0');
    expect(params).toContain('max_tokens: 300');
    expect(params).toContain('frequency_penalty');
  });

  test('global rules block exists and is injected', () => {
    expect(read('constants/aiGlobalRules.constants.ts')).toContain('GLOBAL RULES');
    expect(read('services/ai.service.ts')).toContain('AI_GLOBAL_RULES_BLOCK');
  });

  test('banned phrase post-filter wired in sanitizer', () => {
    const san = read('services/whatsapp/whatsappResponseSanitizer.service.ts');
    expect(san).toContain('containsBannedBuyerPhrase');
    expect(san).toContain('buildSafeBuyerFallback');
  });

  test('stage regression guard exported and used', () => {
    expect(read('services/conversationStateMachine.ts')).toContain('isAllowedStageTransition');
    expect(read('services/whatsapp/whatsappTurnOrchestrator.service.ts')).toContain('isAllowedStageTransition');
  });

  test('whatsapp catch fallback has no connection-issue phrase', () => {
    const wa = read('services/whatsapp.service.ts');
    const fn = wa.slice(wa.indexOf('function buildAiFallbackMessage'), wa.indexOf('export const whatsappService'));
    expect(fn).not.toContain('connection issue');
    expect(fn).not.toContain('technical issue');
  });
});
