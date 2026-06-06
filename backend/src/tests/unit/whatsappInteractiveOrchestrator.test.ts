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
      interactiveId: 'visit-time-prop-1-tomorrow-10am',
    });
    expect(result).toBeNull();
  });

  test('call-me returns unified TurnResult', async () => {
    const result = await tryOrchestratedInteractiveAction({
      ...baseParams,
      interactiveId: 'call-me',
    });
    expect(result?.handled).toBe(true);
    expect(result?.action).toBe('callback-requested');
    expect(result?.turnResult?.text).toContain('15 minutes');
    expect(result?.turnResult?.components).toBeUndefined();
  });

  test('filter shortlist builds list + hero within budget', async () => {
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
    expect(budgeted.some((c) => c.kind === 'media')).toBe(true);
    expect(budgeted.length).toBeLessThanOrEqual(2);
  });
});
