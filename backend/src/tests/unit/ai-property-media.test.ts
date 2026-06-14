/**
 * One-outbound hero media — orchestrator resolution (replaces legacy sendPropertyMediaForStage tests).
 */

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    property: {
      findFirst: jest.fn(),
    },
  },
}));

import prisma from '../../config/prisma';
import {
  enforceTurnComponentBudget,
  resolveHeroMediaComponent,
  resolveHeroMediaComponentFromPropertyIds,
} from '../../services/whatsapp/whatsappTurnOrchestrator.service';

describe('Hero media component (one-outbound-per-turn)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveHeroMediaComponent', () => {
    const mockProperty = {
      id: 'prop-123',
      name: 'Skyline Apartments',
      images: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
    };

    it('returns brochure media when brochure resolution has a component', () => {
      const brochure = {
        mediaComponent: {
          kind: 'media' as const,
          url: 'https://example.com/brochure.pdf',
          mime: 'application/pdf',
        },
      };
      const result = resolveHeroMediaComponent([mockProperty], brochure, 'shortlist');
      expect(result?.kind).toBe('media');
      if (result?.kind === 'media') expect(result.url).toBe('https://example.com/brochure.pdf');
    });

    it('returns hero image for shortlist stage when no brochure', () => {
      const result = resolveHeroMediaComponent([mockProperty], { mediaComponent: null }, 'shortlist');
      expect(result).toEqual({
        kind: 'media',
        url: 'https://example.com/img1.jpg',
        mime: 'image/jpeg',
        caption: 'Skyline Apartments',
      });
    });

    it('returns hero image for rapport stage when no brochure', () => {
      const result = resolveHeroMediaComponent([mockProperty], { mediaComponent: null }, 'rapport');
      expect(result?.kind).toBe('media');
    });

    it('returns undefined when no https images', () => {
      const bad = { ...mockProperty, images: ['http://insecure.jpg'] };
      expect(resolveHeroMediaComponent([bad], { mediaComponent: null }, 'shortlist')).toBeUndefined();
    });
  });

  describe('enforceTurnComponentBudget', () => {
    it('keeps hero media with interactive buttons in one turn', () => {
      const result = enforceTurnComponentBudget([
        { kind: 'buttons', buttons: [{ id: 'a', title: 'A' }] },
        { kind: 'media', url: 'https://x.jpg', mime: 'image/jpeg' },
        { kind: 'buttons', buttons: [{ id: 'b', title: 'B' }] },
      ]);
      expect(result).toHaveLength(2);
      expect(result.some((c) => c.kind === 'media')).toBe(true);
      expect(result.some((c) => c.kind === 'buttons')).toBe(true);
    });
  });

  describe('resolveHeroMediaComponentFromPropertyIds', () => {
    it('fetches property and resolves hero', async () => {
      (prisma.property.findFirst as jest.Mock).mockResolvedValue({
        id: 'prop-1',
        name: 'Lake Vista',
        images: ['https://cdn.example.com/hero.jpg'],
      });

      const result = await resolveHeroMediaComponentFromPropertyIds('company-1', ['prop-1']);
      expect(result?.kind).toBe('media');
      if (result?.kind === 'media') expect(result.url).toBe('https://cdn.example.com/hero.jpg');
    });

    it('returns undefined for empty ids', async () => {
      expect(await resolveHeroMediaComponentFromPropertyIds('company-1', [])).toBeUndefined();
      expect(prisma.property.findFirst).not.toHaveBeenCalled();
    });
  });
});
