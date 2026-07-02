import { tryOrchestratedInteractiveAction } from '../../services/whatsapp/whatsappInteractiveOrchestrator.service';
import { enforceTurnComponentBudget } from '../../services/whatsapp/whatsappTurnOrchestrator.service';
import { mergeInteractiveNewState } from '../../services/whatsapp/whatsappInteractivePersist.service';

const mockFindActiveCallRequest = jest.fn(async (_input?: unknown) => null);

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    features: {
      buyerFocusStack: false,
      buttonScopeValidate: false,
      secondVisitPolicy: false,
    },
  },
}));

jest.mock('../../config/prisma', () => ({
  __esModule: true,
    default: {
    visit: { findFirst: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
    notification: { create: jest.fn() },
    lead: { update: jest.fn() },
    conversation: { update: jest.fn(), findUnique: jest.fn() },
    message: { findFirst: jest.fn(), create: jest.fn() },
    property: { findFirst: jest.fn(), findMany: jest.fn() },
    propertyProject: { count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock('../../services/brochureDelivery.service', () => {
  const actual = jest.requireActual('../../services/brochureDelivery.service');
  return {
    ...actual,
    resolveBrochureForAiTurn: jest.fn(async ({ aiText }: { aiText: string }) => ({
      cleanedText: aiText,
      mediaComponent: null,
    })),
    resolvePropertyDetailMediaComponents: jest.fn(async () => []),
  };
});

jest.mock('../../services/alternativeInventory.service', () => ({
  searchAlternativeTiers: jest.fn(async () => []),
}));

jest.mock('../../services/propertyKnowledge.service', () => ({
  getPropertyKnowledgeForProperty: jest.fn(async () => []),
}));

jest.mock('../../services/propertyAiContext.service', () => {
  const actual = jest.requireActual('../../services/propertyAiContext.service');
  return {
    ...actual,
    enrichAiPropertiesFromKnowledge: jest.fn(async (_companyId: string, props: unknown[]) => props),
  };
});

jest.mock('../../services/visitPendingApproval.service', () => ({
  findPendingVisitApprovalForLead: jest.fn(async () => null),
  createVisitApprovalRequest: jest.fn(),
}));

jest.mock('../../services/projectBrowse.service', () => ({
  companyUsesProjectBrowse: jest.fn(async () => false),
  listProjectsForBuyerBrowse: jest.fn(async () => []),
  formatProjectCatalogIntro: jest.fn(() => ''),
  buildProjectSelectListComponent: jest.fn(() => ({ kind: 'list', title: 'Choose project', sections: [] })),
  loadProjectProperties: jest.fn(async () => null),
  buildProjectPropertyListComponent: jest.fn(),
  buildPropertyDetailButtons: jest.fn(() => ({
    kind: 'buttons',
    buttons: [
      { id: 'book-visit-prop-x', title: 'Book Visit' },
      { id: 'more-info-prop-x', title: 'View Listing' },
      { id: 'project-properties-proj-x', title: 'View Project Listings' },
    ],
  })),
  resolveProjectBrochureMediaComponent: jest.fn(async () => null),
  resolveProjectHeroImageComponent: jest.fn(async () => null),
  formatProjectSelectedIntro: jest.fn(() => ''),
  hasPropertyLocationData: jest.fn(() => true),
  hasEffectiveLocationData: jest.fn(() => true),
  resolveEffectiveLocation: jest.fn((property: unknown) => property),
  PROJECT_LOCATION_SELECT: { locationArea: true, locationCity: true, locationPincode: true, latitude: true, longitude: true },
  buildActiveVisitActionButtons: jest.fn(() => ({
    kind: 'buttons',
    buttons: [
      { id: 'visit-reschedule', title: 'Change Time' },
      { id: 'browse-projects', title: 'View Listings' },
      { id: 'call-me', title: 'Call Agent' },
    ],
  })),
}));

jest.mock('../../services/companyInventoryBrowse.service', () => ({
  getCompanyBrowseSnapshot: jest.fn(async () => ({
    companyId: 'co-1',
    totalListings: 5,
    propertyTypes: ['apartment'],
    bedroomOptions: [2],
    filters: [{ id: 'filter-2bhk', filterKey: '2bhk', title: '2 BHK' }],
    typeSummary: 'apartments',
  })),
  isFilterInCompanyInventory: jest.fn((_snapshot, key: string) => key === '2bhk'),
  buildDiscoveryButtonSet: jest.fn(() => []),
}));

jest.mock('../../services/callRequest.service', () => ({
  findActiveCallRequest: (input: unknown) => mockFindActiveCallRequest(input),
  scheduleCallRequest: jest.fn(async () => ({
    success: true,
    call: { agent_id: 'agent-1' },
  })),
  formatBuyerCallReply: jest.fn(
    (title: string) => `*${title}*\n\nWhen: Mon, 9 Jun 2026, 3:30 pm\n\nOur specialist will confirm the call time with you shortly.`,
  ),
}));

jest.mock('../../utils/callIntentFromMessage.util', () => ({
  resolveCallScheduledAt: jest.fn(() => new Date('2026-06-09T10:00:00.000Z')),
}));

jest.mock('../../services/whatsapp.service', () => ({
  whatsappService: { sendCompanyTextMessage: jest.fn() },
}));

jest.mock('../../services/whatsapp/whatsappTurnOrchestrator.service', () => {
  const actual = jest.requireActual('../../services/whatsapp/whatsappTurnOrchestrator.service');
  return {
    ...actual,
    resolveHeroMediaComponentFromPropertyIds: jest.fn(async () => ({
      kind: 'media',
      url: 'https://cdn.example.com/hero.jpg',
      mime: 'image/jpeg',
    })),
  };
});

import prisma from '../../config/prisma';
import config from '../../config';
import { resolveHeroMediaComponentFromPropertyIds } from '../../services/whatsapp/whatsappTurnOrchestrator.service';
import {
  loadProjectProperties,
  buildPropertyDetailButtons,
  buildProjectPropertyListComponent,
  resolveProjectBrochureMediaComponent,
  resolveProjectHeroImageComponent,
} from '../../services/projectBrowse.service';

const baseParams = {
  lead: {
    id: 'lead-1',
    customerName: 'Raj',
    phone: '+919999999999',
    assignedAgentId: null,
    propertyType: null,
    budgetMin: null,
    budgetMax: null,
    locationPreference: null,
    notes: null,
  },
  conversation: { id: 'conv-1', selectedPropertyId: null, commitments: {} },
  company: { id: 'co-1', name: 'Palm Realty' },
};

describe('whatsappInteractiveOrchestrator.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindActiveCallRequest.mockResolvedValue(null);
    config.features.buyerFocusStack = false;
    config.features.buttonScopeValidate = false;
    config.features.secondVisitPolicy = false;
  });

  test('returns null for unrecognized interactive ids', async () => {
    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'unknown-action-xyz',
    });
    expect(result).toBeNull();
  });

  test('visit-slot-morning routes to book-visit-initiated TurnResult', async () => {
    (prisma.property.findFirst as jest.Mock).mockResolvedValue({ id: 'prop-sunset', name: 'Sunset Heights' });
    (prisma.notification.create as jest.Mock).mockResolvedValue({});
    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'visit-slot-morning',
      conversation: { id: 'conv-1', selectedPropertyId: 'prop-sunset', commitments: {} },
    });
    expect(result?.action).toBe('book-visit-initiated');
    expect(result?.turnResult?.text).toContain('Sunset Heights');
    expect(result?.turnResult?.components?.[0]).toMatchObject({ kind: 'buttons' });
  });

  test('call-me returns unified TurnResult', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ name: 'Kiran' });
    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'call-me',
    });
    expect(result?.handled).toBe(true);
    expect(result?.action).toBe('callback-requested');
    expect(result?.turnResult?.text).toContain('Callback request sent');
    // When call booking succeeds, management buttons are attached (Change Time, Cancel, Call Agent)
    if (result?.turnResult?.components?.length) {
      expect(result.turnResult.components[0]).toMatchObject({ kind: 'buttons' });
    }
  });

  test('WAI-TRUST-20260701-08 stale call-reschedule button does not ask for another preferred time', async () => {
    mockFindActiveCallRequest.mockResolvedValue(null);

    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'call-reschedule',
    });

    expect(result?.handled).toBe(true);
    expect(result?.action).toBe('callback-reschedule-no-active-callback');
    expect(result?.turnResult?.text).toMatch(/already passed|no longer active/i);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  test('WAI-TRUST-20260701-08 live call-reschedule button asks for a fresh preferred time', async () => {
    mockFindActiveCallRequest.mockResolvedValue({
      id: 'call-1',
      status: 'confirmed',
      scheduled_at: new Date(Date.now() + 60 * 60 * 1000),
      agent_id: 'agent-1',
    });

    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'call-reschedule',
    });

    expect(result?.handled).toBe(true);
    expect(result?.action).toBe('callback-reschedule-prompt');
    expect(result?.turnResult?.text).toMatch(/preferred call time/i);
    expect(prisma.conversation.update).toHaveBeenCalled();
  });

  test('filter shortlist builds list + hero within budget', async () => {
    (resolveHeroMediaComponentFromPropertyIds as jest.Mock).mockResolvedValue(null);
    (prisma.message.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.lead.update as jest.Mock).mockResolvedValue({
      ...baseParams.lead,
      budgetMin: null,
      budgetMax: null,
      locationPreference: null,
    });
    (prisma.conversation.update as jest.Mock).mockResolvedValue({});
    (prisma.message.create as jest.Mock).mockResolvedValue({});
    (prisma.property.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'prop-1',
        name: 'Sunrise Apartments',
        priceMin: 5000000,
        locationArea: 'Whitefield',
        locationCity: 'Bangalore',
      },
    ]);

    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'filter-2bhk',
    });

    expect(result?.action).toBe('filter-applied');
    expect(result?.newState?.stage).toBe('shortlist');
    const components = result?.turnResult?.components ?? [];
    const budgeted = enforceTurnComponentBudget(components);
    expect(budgeted.some((c) => c.kind === 'list')).toBe(true);
    expect(budgeted.some((c) => c.kind === 'media')).toBe(false);
    expect(budgeted.length).toBe(1);
  });

  test('filter duplicate tap returns prior reply text', async () => {
    (prisma.message.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: 'dup-check' })
      .mockResolvedValueOnce({ content: 'Great choice! Found 2 2 BHK properties for you!' });
    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'filter-2bhk',
    });
    expect(result?.action).toBe('filter-duplicate-prevented');
    expect(result?.turnResult?.text).toContain('Great choice');
    expect(result?.turnResult?.replyPacing).toBe('none');
  });

  test('more-info with active visit for different property shows booked visit name not selected property', async () => {
    const lakeVista = {
      id: 'prop-lake',
      name: 'Lake Vista 801',
      companyId: 'co-1',
      status: 'available',
      priceMin: 13200000,
      priceMax: 13800000,
      propertyType: 'apartment',
      bedrooms: 3,
      locationArea: 'Sarjapur Road',
      locationCity: 'Bengaluru',
      builder: 'Sobha Limited',
      reraNumber: 'PRM/KA/RERA/1251/446/PR/190618/002341',
      brochureUrl: null,
      projectId: 'proj-lake',
      amenities: ['Lake view', 'Pool'],
      description: 'Premium lake-facing unit',
      extendedAttributes: {},
    };
    (prisma.property.findFirst as jest.Mock).mockImplementation(async (args: { where: { id?: string } }) => {
      if (args.where.id === 'prop-lake') return lakeVista;
      if (args.where.id === 'prop-sunset') return { id: 'prop-sunset', name: 'Sunset Heights 1102' };
      return null;
    });
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue({
      id: 'visit-1',
      propertyId: 'prop-sunset',
      status: 'confirmed',
      scheduledAt: new Date('2026-06-17T04:30:00.000Z'),
      property: null,
    });
    (resolveHeroMediaComponentFromPropertyIds as jest.Mock).mockResolvedValue(null);

    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'more-info-prop-lake',
    });

    expect(result?.action).toBe('more-info-sent');
    const text = result?.turnResult?.text ?? '';
    expect(text).toContain('Lake Vista 801');
    expect(text).toContain('Sunset Heights 1102');
    expect(text).not.toMatch(/Your visit for \*Lake Vista 801\* on .* is confirmed/i);
    expect(text).toMatch(/confirmed visit is for \*Sunset Heights 1102\*/i);
  });

  test('project select sets focus newState when buyerFocusStack ON', async () => {
    config.features.buyerFocusStack = true;
    (loadProjectProperties as jest.Mock).mockResolvedValue({
      project: { name: 'Lake Vista' },
      properties: [
        { id: 'prop-a', name: 'Unit A' },
        { id: 'prop-b', name: 'Unit B' },
      ],
      hiddenListingCount: 0,
    });
    (buildProjectPropertyListComponent as jest.Mock).mockReturnValue({
      kind: 'list',
      title: 'Units',
      sections: [{ title: 'Units', rows: [] }],
    });

    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'project-select-proj-lake',
    });

    expect(result?.action).toBe('project-selected');
    expect(result?.newState).toMatchObject({
      stage: 'shortlist',
      focusedProjectId: 'proj-lake',
      focusedPropertyId: null,
      recommendedPropertyIds: ['prop-a', 'prop-b'],
    });
  });

  test('INVESTO-20260630-PROJECT-PROPERTY-MEDIA-ISOLATION project select sends only project-scoped media plus property list', async () => {
    (loadProjectProperties as jest.Mock).mockResolvedValue({
      project: { id: 'proj-lake', name: 'Lake Vista', description: null },
      properties: [
        { id: 'prop-a', name: 'Unit A' },
        { id: 'prop-b', name: 'Unit B' },
      ],
      hiddenListingCount: 0,
    });
    (buildProjectPropertyListComponent as jest.Mock).mockReturnValue({
      kind: 'list',
      title: 'Choose property',
      sections: [{ title: 'Units', rows: [] }],
    });
    (resolveProjectBrochureMediaComponent as jest.Mock).mockResolvedValueOnce({
      kind: 'media',
      url: 'https://signed.example/project-brochure.pdf',
      mime: 'application/pdf',
      caption: 'Lake Vista',
    });
    (resolveProjectHeroImageComponent as jest.Mock).mockResolvedValueOnce({
      kind: 'media',
      url: 'https://signed.example/project-hero.jpg',
      mime: 'image/jpeg',
      caption: 'Lake Vista',
    });

    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'project-select-proj-lake',
    });

    expect(resolveProjectBrochureMediaComponent).toHaveBeenCalledWith('co-1', 'proj-lake', 'Lake Vista');
    expect(resolveProjectHeroImageComponent).toHaveBeenCalledWith('co-1', 'proj-lake', 'Lake Vista');
    const components = result?.turnResult?.components ?? [];
    expect(components.filter((c) => c.kind === 'media')).toHaveLength(2);
    expect(components.some((c) => c.kind === 'list')).toBe(true);
  });

  test('more-info attaches native property media to turn result', async () => {
    const { resolvePropertyDetailMediaComponents } = await import('../../services/brochureDelivery.service');
    (resolvePropertyDetailMediaComponents as jest.Mock).mockResolvedValueOnce([
      { kind: 'media', url: 'https://signed.example/hero.jpg', mime: 'image/jpeg', caption: 'Sunset 1102' },
      { kind: 'media', url: 'https://signed.example/brochure.pdf', mime: 'application/pdf', caption: 'Brochure' },
    ]);

    const unit = {
      id: 'prop-unit-1',
      name: 'Sunset 1102',
      companyId: 'co-1',
      status: 'available',
      priceMin: 9000000,
      priceMax: 9500000,
      propertyType: 'apartment',
      bedrooms: 2,
      locationArea: 'Whitefield',
      locationCity: 'Bengaluru',
      builder: 'Builder',
      reraNumber: 'RERA',
      brochureUrl: 'investo/companies/co/properties/p/brochure/x.pdf',
      images: ['investo/companies/co/properties/p/image/x.jpg'],
      projectId: 'proj-sunset',
      amenities: [],
      description: 'Nice unit',
      extendedAttributes: {},
    };
    (prisma.property.findFirst as jest.Mock).mockResolvedValue(unit);
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue(null);
    (buildPropertyDetailButtons as jest.Mock).mockReturnValue({
      kind: 'buttons',
      buttons: [{ id: 'book-visit-prop-unit-1', title: 'Book Visit' }],
    });

    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'more-info-prop-unit-1',
    });

    expect(resolvePropertyDetailMediaComponents).toHaveBeenCalled();
    const media = (result?.turnResult?.components ?? []).filter((c) => c.kind === 'media');
    expect(media).toHaveLength(2);
  });

  test('repeat more-info tap on already-focused property does not resend media', async () => {
    const unit = {
      id: 'prop-unit-1',
      name: 'Sunset 1102',
      companyId: 'co-1',
      status: 'available',
      priceMin: 9000000,
      priceMax: 9500000,
      propertyType: 'apartment',
      bedrooms: 2,
      locationArea: 'Whitefield',
      locationCity: 'Bengaluru',
      builder: 'Builder',
      reraNumber: 'RERA',
      brochureUrl: 'investo/companies/co/properties/p/brochure/x.pdf',
      images: ['investo/companies/co/properties/p/image/x.jpg'],
      projectId: 'proj-sunset',
      amenities: [],
      description: 'Nice unit',
      extendedAttributes: {},
    };
    (prisma.property.findFirst as jest.Mock).mockResolvedValue(unit);
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue(null);
    (buildPropertyDetailButtons as jest.Mock).mockReturnValue({
      kind: 'buttons',
      buttons: [{ id: 'book-visit-prop-unit-1', title: 'Book Visit' }],
    });

    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'more-info-prop-unit-1',
      conversation: { id: 'conv-1', selectedPropertyId: 'prop-unit-1', commitments: {} },
    });

    expect(result?.action).toBe('more-info-sent');
    const media = (result?.turnResult?.components ?? []).filter((c) => c.kind === 'media');
    expect(media).toHaveLength(0);
    const buttons = (result?.turnResult?.components ?? []).filter((c) => c.kind === 'buttons');
    expect(buttons).toHaveLength(1);
  });

  test('book-visit tap clears stale awaiting-call-time marker so time replies book the visit', async () => {
    (prisma.property.findFirst as jest.Mock).mockResolvedValue({
      id: 'prop-sunset',
      name: 'Sunset Heights',
      projectId: null,
    });
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
      commitments: { awaitingCallTime: true },
    });
    (prisma.conversation.update as jest.Mock).mockResolvedValue({});

    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'book-visit-prop-sunset',
      conversation: {
        id: 'conv-1',
        selectedPropertyId: 'prop-sunset',
        commitments: { awaitingCallTime: true },
      },
    });

    expect(result?.action).toBe('book-visit-initiated');
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-1' },
        data: { commitments: expect.not.objectContaining({ awaitingCallTime: true }) },
      }),
    );
  });

  test('more-info sets focusedPropertyId when buyerFocusStack ON', async () => {
    config.features.buyerFocusStack = true;
    const unit = {
      id: 'prop-unit-1',
      name: 'Sunset 1102',
      companyId: 'co-1',
      status: 'available',
      priceMin: 9000000,
      priceMax: 9500000,
      propertyType: 'apartment',
      bedrooms: 2,
      locationArea: 'Whitefield',
      locationCity: 'Bengaluru',
      builder: 'Builder',
      reraNumber: 'RERA',
      brochureUrl: null,
      projectId: 'proj-sunset',
      amenities: [],
      description: 'Nice unit',
      extendedAttributes: {},
    };
    (prisma.property.findFirst as jest.Mock).mockResolvedValue(unit);
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue(null);
    (resolveHeroMediaComponentFromPropertyIds as jest.Mock).mockResolvedValue(null);
    (buildPropertyDetailButtons as jest.Mock).mockReturnValue({
      kind: 'buttons',
      buttons: [{ id: 'book-visit-prop-unit-1', title: 'Book Visit' }],
    });

    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'more-info-prop-unit-1',
      conversation: {
        id: 'conv-1',
        selectedPropertyId: null,
        recommendedPropertyIds: ['prop-unit-1'],
        commitments: { focusedProjectId: 'proj-sunset' },
      },
    });

    expect(result?.action).toBe('more-info-sent');
    expect(result?.newState).toMatchObject({
      focusedPropertyId: 'prop-unit-1',
      focusedProjectId: 'proj-sunset',
      selectedPropertyId: 'prop-unit-1',
    });
  });

  test('book visit allows cross-project explicit tap when second visit policy ON', async () => {
    config.features.buyerFocusStack = true;
    config.features.secondVisitPolicy = true;
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue({
      id: 'visit-1',
      propertyId: 'prop-sunset',
      status: 'confirmed',
      scheduledAt: new Date('2026-06-17T04:30:00.000Z'),
      property: { projectId: 'proj-sunset', name: 'Sunset Heights' },
    });
    (prisma.property.findFirst as jest.Mock).mockResolvedValue({
      id: 'prop-lake',
      name: 'Lake Vista',
      projectId: 'proj-lake',
      status: 'available',
    });

    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'book-visit-prop-lake',
    });

    expect(result?.action).toBe('book-visit-initiated');
    expect(result?.newState).toMatchObject({
      focusedPropertyId: 'prop-lake',
      focusedProjectId: 'proj-lake',
    });
  });

  test('book visit blocks same property when active visit and flags ON', async () => {
    config.features.buyerFocusStack = true;
    config.features.secondVisitPolicy = true;
    (prisma.visit.findFirst as jest.Mock).mockResolvedValue({
      id: 'visit-1',
      propertyId: 'prop-sunset',
      status: 'confirmed',
      scheduledAt: new Date('2026-06-17T04:30:00.000Z'),
      property: { projectId: 'proj-sunset', name: 'Sunset Heights' },
    });
    (prisma.property.findFirst as jest.Mock).mockResolvedValue({
      id: 'prop-sunset',
      name: 'Sunset Heights',
      projectId: 'proj-sunset',
      status: 'available',
    });

    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'book-visit-prop-sunset',
    });

    expect(result?.action).toBe('book-visit-same-property');
  });

  test('mergeInteractiveNewState legacy path when flag OFF', () => {
    config.features.buyerFocusStack = false;
    const merged = mergeInteractiveNewState(
      { selectedPropertyId: null, commitments: {} },
      { selectedPropertyId: 'prop-1', stage: 'shortlist' },
    );
    expect(merged.newState).toEqual({ stage: 'shortlist', selectedPropertyId: 'prop-1' });
    expect(merged.prismaData.selectedPropertyId).toBe('prop-1');
  });

  test('mergeInteractiveNewState writes focus commitments when flag ON', () => {
    config.features.buyerFocusStack = true;
    const merged = mergeInteractiveNewState(
      { selectedPropertyId: null, recommendedPropertyIds: [], commitments: {} },
      {
        focusedProjectId: 'proj-a',
        focusedPropertyId: 'prop-1',
        recommendedPropertyIds: ['prop-1', 'prop-2'],
        stage: 'shortlist',
      },
    );
    expect(merged.newState.selectedPropertyId).toBe('prop-1');
    expect(merged.prismaData.commitments).toMatchObject({
      focusedProjectId: 'proj-a',
      selectedProjectId: 'proj-a',
    });
    expect(merged.prismaData.recommendedPropertyIds).toEqual(['prop-1', 'prop-2']);
  });
});
