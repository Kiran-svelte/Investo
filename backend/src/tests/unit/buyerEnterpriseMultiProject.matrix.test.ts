/**
 * Multi-project enterprise integration matrix (Chunk 10).
 * Table-driven tests wiring Chunks 01–09 modules together with mocked Prisma.
 */

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    property: { findMany: jest.fn(), count: jest.fn() },
    propertyProject: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    lead: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
    conversation: { findUnique: jest.fn(), update: jest.fn() },
    visit: { findMany: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('../../services/visitPendingApproval.service', () => ({
  findPendingVisitApprovalForLead: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/callRequest.service', () => ({
  findActiveCallRequest: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../services/visitState.service', () => ({
  cancelVisitById: jest.fn().mockResolvedValue({ success: true }),
  confirmVisitById: jest.fn().mockResolvedValue({ success: true }),
  rescheduleVisitById: jest.fn().mockResolvedValue({ success: true }),
}));

import config from '../../config';
import prisma from '../../config/prisma';
import {
  patchBuyerConversationFocus,
  readBuyerConversationFocus,
} from '../../services/buyer/buyerConversationFocus.service';
import { resolveBuyerAiPropertyCatalog } from '../../services/buyer/buyerScopedCatalog.service';
import { validateBuyerOutbound } from '../../services/buyer/buyerOutboundValidator.service';
import { validateBuyerButtonSet } from '../../services/buyer/buyerButtonScope.service';
import {
  evaluateSecondVisitPolicy,
  shouldUseVisitAwareButtonsOnly,
} from '../../services/buyer/buyerEnterpriseUx.service';
import { selectPrimaryVisit } from '../../services/liveLeadContext.service';
import {
  findTargetVisitsWithDisambiguation,
  applyVisitMutationFromChat,
} from '../../services/visitMutationFromChat.service';
import { confirmVisitById } from '../../services/visitState.service';
import { resolveSituationBuyerButtons } from '../../utils/buyerSituationButtons.util';

const companyId = 'co-mp';
const projA = 'proj-a';
const projB = 'proj-b';
const propA1 = 'prop-a1';
const propB1 = 'prop-b1';
const propC1 = 'prop-c1';

function enableAllEnterpriseFlags(): void {
  config.features.multiVisitContext = true;
  config.features.buyerFocusStack = true;
  config.features.scopedPropertyResolve = true;
  config.features.scopedAiCatalog = true;
  config.features.visitDisambiguation = true;
  config.features.buttonScopeValidate = true;
  config.features.outboundPropertyValidate = true;
  config.features.secondVisitPolicy = true;
}

type EnterpriseFlagSnapshot = Pick<typeof config.features,
  | 'multiVisitContext'
  | 'buyerFocusStack'
  | 'scopedPropertyResolve'
  | 'scopedAiCatalog'
  | 'visitDisambiguation'
  | 'buttonScopeValidate'
  | 'outboundPropertyValidate'
  | 'secondVisitPolicy'
>;

function restoreFlags(snapshot: EnterpriseFlagSnapshot): void {
  config.features.multiVisitContext = snapshot.multiVisitContext;
  config.features.buyerFocusStack = snapshot.buyerFocusStack;
  config.features.scopedPropertyResolve = snapshot.scopedPropertyResolve;
  config.features.scopedAiCatalog = snapshot.scopedAiCatalog;
  config.features.visitDisambiguation = snapshot.visitDisambiguation;
  config.features.buttonScopeValidate = snapshot.buttonScopeValidate;
  config.features.outboundPropertyValidate = snapshot.outboundPropertyValidate;
  config.features.secondVisitPolicy = snapshot.secondVisitPolicy;
}

describe('multi-project enterprise matrix MP-01..MP-08', () => {
  const flagSnapshot: EnterpriseFlagSnapshot = {
    multiVisitContext: config.features.multiVisitContext,
    buyerFocusStack: config.features.buyerFocusStack,
    scopedPropertyResolve: config.features.scopedPropertyResolve,
    scopedAiCatalog: config.features.scopedAiCatalog,
    visitDisambiguation: config.features.visitDisambiguation,
    buttonScopeValidate: config.features.buttonScopeValidate,
    outboundPropertyValidate: config.features.outboundPropertyValidate,
    secondVisitPolicy: config.features.secondVisitPolicy,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    enableAllEnterpriseFlags();
  });

  afterEach(() => {
    restoreFlags(flagSnapshot);
  });

  test('MP-01 browse project A → unit sets focus.projectId = A and scoped catalog', async () => {
    const { focus } = patchBuyerConversationFocus(
      readBuyerConversationFocus({
        selectedPropertyId: null,
        recommendedPropertyIds: [],
        commitments: {},
      }),
      {
        focusedProjectId: projA,
        focusedPropertyId: propA1,
        recommendedPropertyIds: [propA1, propC1],
      },
    );
    expect(focus.focusedProjectId).toBe(projA);
    expect(focus.focusedPropertyId).toBe(propA1);
    expect(focus.allowedPropertyIds).toContain(propA1);

    (prisma.property.findMany as jest.Mock).mockResolvedValue([
      { id: propA1, name: 'Sunset 1102', projectId: projA, status: 'available' },
      { id: propC1, name: 'Sunset 1204', projectId: projA, status: 'available' },
    ]);

    const catalog = await resolveBuyerAiPropertyCatalog({
      companyId,
      focus,
      resolvedPropertyId: propA1,
      neverSayNoPropertyIds: [],
      conversionAlternativeIds: [],
    });
    expect(catalog.catalogMode).toBe('focused');
    expect(catalog.properties.every((p) => p.projectId === projA || p.id === propA1)).toBe(true);
  });

  test('MP-02 price reply validator strips out-of-scope property names', () => {
    const text =
      'Sunset Heights starts at ₹95L with flexible payment plans and possession by 2027 for early buyers. '
      + 'Lake Vista Tower is ₹1.1Cr.';
    const result = validateBuyerOutbound({
      text,
      allowedPropertyIds: [propA1],
      propertyNamesById: new Map([[propA1, 'Sunset Heights']]),
      catalogNamesForDetection: [
        { id: propA1, name: 'Sunset Heights', projectId: projA },
        { id: propB1, name: 'Lake Vista Tower', projectId: projB },
      ],
      visitPropertyIds: [],
      language: 'en',
    });
    expect(result.modified).toBe(true);
    expect(result.strippedMentions).toContain('Lake Vista Tower');
    expect(result.action).not.toBe('replace_with_clarify');
    expect(result.text).toMatch(/Sunset Heights/i);
    expect(result.text).not.toMatch(/Lake Vista Tower/i);
  });

  test('MP-03 two same-day visits → confirm asks which visit', async () => {
    (prisma.visit.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'v-a',
        status: 'confirmed',
        scheduledAt: new Date('2026-06-14T10:30:00.000Z'),
        propertyId: propA1,
        property: { name: 'Sunset Heights' },
        lead: { id: 'lead-1', customerName: 'Ravi', phone: '+919999999999' },
      },
      {
        id: 'v-b',
        status: 'scheduled',
        scheduledAt: new Date('2026-06-14T12:30:00.000Z'),
        propertyId: propB1,
        property: { name: 'Lake Vista' },
        lead: { id: 'lead-1', customerName: 'Ravi', phone: '+919999999999' },
      },
    ]);

    const resolution = await findTargetVisitsWithDisambiguation(
      { companyId, leadId: 'lead-1', message: 'confirm my visit' },
      'confirm',
    );
    expect(resolution.status).toBe('disambiguate');
    if (resolution.status === 'disambiguate') {
      expect(resolution.candidates.length).toBe(2);
    }
  });

  test('MP-04 disambiguation reply "2" confirms visit B only', async () => {
    (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
      commitments: {
        visit_disambiguation: {
          kind: 'visit_disambiguation',
          candidateVisitIds: ['v-a', 'v-b'],
          action: 'confirm',
          createdAt: new Date().toISOString(),
        },
      },
    });
    (prisma.conversation.update as jest.Mock).mockResolvedValue({});
    (prisma.visit.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'v-a',
        status: 'scheduled',
        scheduledAt: new Date('2026-06-14T10:30:00.000Z'),
        propertyId: propA1,
        property: { name: 'Sunset Heights' },
        lead: { id: 'lead-1', customerName: 'Ravi', phone: '+919999999999' },
      },
      {
        id: 'v-b',
        status: 'scheduled',
        scheduledAt: new Date('2026-06-14T12:30:00.000Z'),
        propertyId: propB1,
        property: { name: 'Lake Vista' },
        lead: { id: 'lead-1', customerName: 'Ravi', phone: '+919999999999' },
      },
    ]);

    const result = await applyVisitMutationFromChat({
      companyId,
      leadId: 'lead-1',
      conversationId: 'conv-1',
      message: '2',
      suppressCustomerNotification: true,
    });
    expect(result.handled).toBe(true);
    expect(result.mode).toBe('confirmed');
    expect(confirmVisitById).toHaveBeenCalledWith(
      expect.objectContaining({ visitId: 'v-b' }),
    );
  });

  test('MP-05 active visit A + more-info B keeps visit-era buttons on price reply', () => {
    expect(
      shouldUseVisitAwareButtonsOnly(true, 'price_discussed', {
        inboundMessageText: 'What is the price?',
      }),
    ).toBe(true);

    const buttons = resolveSituationBuyerButtons({
      stage: 'shortlist',
      outboundText: 'Lake Vista 304 starts from ₹88L.',
      propertyId: propB1,
      hasActiveVisit: true,
      visitStatus: 'confirmed',
      visitPropertyProjectId: projA,
      visitPropertyId: propA1,
      allowedPropertyIds: [propB1],
      language: 'en',
    });
    const ids = buttons?.map((b) => b.id) ?? [];
    expect(ids).toContain('visit-reschedule');
    expect(ids.some((id) => id.startsWith('book-visit'))).toBe(false);
  });

  test('MP-06 active visit A + explicit book B allows different project', () => {
    const decision = evaluateSecondVisitPolicy({
      hasActiveVisit: true,
      activeVisitPropertyId: propA1,
      activeVisitProjectId: projA,
      targetPropertyId: propB1,
      targetProjectId: projB,
      explicitCrossProjectIntent: true,
    });
    expect(decision).toEqual({ allow: true, reason: 'different_project' });
  });

  test('MP-07 multi-property list does not offer book-visit for first of three', () => {
    const raw = resolveSituationBuyerButtons({
      stage: 'shortlist',
      outboundText: 'Here are three options across projects.',
      propertyId: propA1,
      recommendedPropertyIds: [propA1, propB1, propC1],
      allowedPropertyIds: [propA1, propB1, propC1],
      language: 'en',
    }) ?? [];
    const validated = validateBuyerButtonSet(raw, {
      allowedPropertyIds: [propA1, propB1, propC1],
      language: 'en',
    });
    const ids = validated.map((b) => b.id);
    expect(ids.some((id) => id === `book-visit-${propA1}`)).toBe(false);
    expect(ids.some((id) => id.startsWith('book-visit'))).toBe(false);
  });

  test('MP-08 single-project company parity — catalog loads project inventory', async () => {
    (prisma.propertyProject.count as jest.Mock).mockResolvedValue(1);
    (prisma.propertyProject.findFirst as jest.Mock).mockResolvedValue({ id: 'only-proj' });
    (prisma.property.findMany as jest.Mock).mockResolvedValue([
      { id: 'only-1', name: 'Only Tower 101', projectId: 'only-proj', status: 'available' },
      { id: 'only-2', name: 'Only Tower 102', projectId: 'only-proj', status: 'available' },
    ]);

    const focus = readBuyerConversationFocus({
      selectedPropertyId: null,
      recommendedPropertyIds: [],
      commitments: {},
    });

    const catalog = await resolveBuyerAiPropertyCatalog({
      companyId,
      focus,
      resolvedPropertyId: null,
      neverSayNoPropertyIds: [],
      conversionAlternativeIds: [],
    });
    expect(catalog.catalogMode).toBe('single_project');
    expect(catalog.properties.length).toBeGreaterThan(0);
  });
});

describe('single project parity', () => {
  const flagSnapshot: EnterpriseFlagSnapshot = {
    multiVisitContext: config.features.multiVisitContext,
    buyerFocusStack: config.features.buyerFocusStack,
    scopedPropertyResolve: config.features.scopedPropertyResolve,
    scopedAiCatalog: config.features.scopedAiCatalog,
    visitDisambiguation: config.features.visitDisambiguation,
    buttonScopeValidate: config.features.buttonScopeValidate,
    outboundPropertyValidate: config.features.outboundPropertyValidate,
    secondVisitPolicy: config.features.secondVisitPolicy,
  };

  beforeEach(() => {
    enableAllEnterpriseFlags();
  });

  afterEach(() => {
    restoreFlags(flagSnapshot);
  });

  test('primary visit selection matches legacy when one upcoming visit', () => {
    const at = new Date('2026-06-14T10:30:00.000Z');
    const visit = {
      visitId: 'v1',
      propertyId: propA1,
      propertyName: 'Sunset 1102',
      projectId: projA,
      status: 'confirmed',
      scheduledAt: at,
      agentName: null,
      agentPhone: null,
      notes: null,
    };
    expect(selectPrimaryVisit([visit])?.visitId).toBe('v1');
  });

  test('enterprise v2 visit button matrix unchanged with all flags ON', () => {
    const buttons = resolveSituationBuyerButtons({
      stage: 'shortlist',
      outboundText: 'Pricing is ₹95L for Sunset Heights.',
      propertyId: propA1,
      hasActiveVisit: true,
      visitStatus: 'confirmed',
      visitPropertyProjectId: projA,
      language: 'en',
    });
    const ids = buttons?.map((b) => b.id) ?? [];
    expect(ids).toContain('visit-reschedule');
    expect(ids).toContain('project-properties-proj-a');
    expect(ids.some((id) => id.startsWith('book-visit'))).toBe(false);
  });
});
