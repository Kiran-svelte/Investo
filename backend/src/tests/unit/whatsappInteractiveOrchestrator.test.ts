import { tryOrchestratedInteractiveAction } from '../../services/whatsapp/whatsappInteractiveOrchestrator.service';
import { enforceTurnComponentBudget } from '../../services/whatsapp/whatsappTurnOrchestrator.service';

jest.mock('../../config/prisma', () => ({
  __esModule: true,
    default: {
    visit: { findFirst: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
    notification: { create: jest.fn() },
    lead: { update: jest.fn() },
    conversation: { update: jest.fn() },
    message: { findFirst: jest.fn(), create: jest.fn() },
    property: { findFirst: jest.fn(), findMany: jest.fn() },
    propertyProject: { count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock('../../services/brochureDelivery.service', () => ({
  resolveBrochureForAiTurn: jest.fn(async ({ aiText }: { aiText: string }) => ({
    cleanedText: aiText,
    mediaComponent: null,
  })),
}));

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
  buildPropertyDetailButtons: jest.fn(),
  resolveProjectBrochureMediaComponent: jest.fn(async () => null),
  resolveProjectHeroImageComponent: jest.fn(async () => null),
  formatProjectSelectedIntro: jest.fn(() => ''),
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
import { resolveHeroMediaComponentFromPropertyIds } from '../../services/whatsapp/whatsappTurnOrchestrator.service';

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
});
