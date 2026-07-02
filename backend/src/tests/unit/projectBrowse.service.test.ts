jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    propertyProjectFile: { findFirst: jest.fn() },
    property: { findFirst: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock('../../services/storage.service', () => ({
  storageService: {
    getPublicUrl: jest.fn((key: string) => `https://storage.example/${key}`),
  },
}));

jest.mock('../../services/brochureDelivery.service', () => ({
  resolveBrochureUrlForWhatsApp: jest.fn(async (url: string) => `https://signed.example/${encodeURIComponent(url)}`),
  resolveStorageReferenceForWhatsApp: jest.fn(async (url: string) => `https://signed.example/${encodeURIComponent(url)}`),
}));

import {
  buildProjectSelectListComponent,
  buildProjectPropertyListComponent,
  buildPropertyDetailButtons,
  buildActiveVisitActionButtons,
  formatProjectCatalogIntro,
  formatProjectSelectedIntro,
  hasPropertyLocationData,
  resolveProjectBrochureMediaComponent,
  resolveProjectHeroImageComponent,
} from '../../services/projectBrowse.service';
import prisma from '../../config/prisma';
import { storageService } from '../../services/storage.service';
import {
  resolveBrochureUrlForWhatsApp,
  resolveStorageReferenceForWhatsApp,
} from '../../services/brochureDelivery.service';

describe('projectBrowse.service', () => {
  const sampleProjects = [
    {
      id: 'proj-investo',
      name: 'investo',
      description: null,
      propertyCount: 19,
      propertyTypes: ['apartment'],
      locationLabel: 'Hyderabad',
      priceLabel: '₹81.0L–₹140.0L',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('buildProjectSelectListComponent uses project-select ids and localized title', () => {
    const list = buildProjectSelectListComponent(sampleProjects, 'hi');
    expect(list.kind).toBe('list');
    if (list.kind !== 'list') throw new Error('expected list');
    expect(list.title).toContain('परियोजना');
    expect(list.sections[0].rows[0].id).toBe('project-select-proj-investo');
    expect(list.sections[0].rows[0].title).toBe('investo');
  });

  it('buildProjectPropertyListComponent uses more-info property ids and localized title', () => {
    const list = buildProjectPropertyListComponent('proj-investo', 'investo', [
      {
        id: 'prop-lake-801',
        name: 'Lake Vista 801',
        propertyType: 'apartment',
        locationArea: 'Kondapur',
        locationCity: 'Hyderabad',
        priceMin: 13000000,
        priceMax: 14000000,
        bedrooms: 3,
        brochureUrl: null,
        images: [],
      },
    ], 'hi');
    if (list.kind !== 'list') throw new Error('expected list');
    expect(list.title).toContain('संपत्ति');
    expect(list.sections[0].rows[0].id).toBe('more-info-prop-lake-801');
    expect(list.sections[0].rows[0].title).toBe('Lake Vista 801');
  });

  it('buildPropertyDetailButtons includes book visit, view listing, and project listings', () => {
    const buttons = buildPropertyDetailButtons('prop-1', 'proj-investo', 'en');
    expect(buttons.kind).toBe('buttons');
    if (buttons.kind !== 'buttons') throw new Error('expected buttons');
    expect(buttons.buttons.map((b) => b.id)).toEqual([
      'book-visit-prop-1',
      'more-info-prop-1',
      'project-properties-proj-investo',
    ]);
  });

  it('buildPropertyDetailButtons uses Location only when verified location exists', () => {
    const buttons = buildPropertyDetailButtons('prop-1', 'proj-investo', 'en', { hasLocation: true });
    expect(buttons.kind).toBe('buttons');
    if (buttons.kind !== 'buttons') throw new Error('expected buttons');
    expect(buttons.buttons.map((b) => b.id)).toEqual([
      'book-visit-prop-1',
      'more-info-prop-1',
      'location-prop-1',
    ]);
  });

  it('hasPropertyLocationData requires address or coordinates', () => {
    expect(hasPropertyLocationData({ locationArea: 'Whitefield' })).toBe(true);
    expect(hasPropertyLocationData({ latitude: '12.9', longitude: '77.7' })).toBe(true);
    expect(hasPropertyLocationData({ locationArea: '', latitude: null, longitude: null })).toBe(false);
  });

  it('formatProjectCatalogIntro mentions project not individual units', () => {
    const text = formatProjectCatalogIntro(sampleProjects, 'en');
    expect(text).toContain('investo');
    expect(text).toContain('19');
    expect(text).not.toContain('Lake Vista');
  });

  it('formatProjectCatalogIntro uses Devanagari for Hindi', () => {
    const text = formatProjectCatalogIntro(sampleProjects, 'hi');
    expect(text).toMatch(/[\u0900-\u097F]/);
    expect(text).toContain('investo');
  });

  it('formatProjectSelectedIntro includes hidden listing note', () => {
    const text = formatProjectSelectedIntro('investo', 4, 'hi', 1);
    expect(text).toMatch(/[\u0900-\u097F]/);
    expect(text).toContain('4');
  });

  it('buildActiveVisitActionButtons omits property details and offers view listings', () => {
    const buttons = buildActiveVisitActionButtons('proj-investo', 'en');
    expect(buttons.kind).toBe('buttons');
    if (buttons.kind !== 'buttons') throw new Error('expected buttons');
    expect(buttons.buttons.map((b) => b.id)).toEqual([
      'visit-reschedule',
      'project-properties-proj-investo',
      'call-me',
    ]);
    expect(buttons.buttons.map((b) => b.id)).not.toContain('more-info');
  });

  it('buildActiveVisitActionButtons uses browse-projects when no projectId', () => {
    const buttons = buildActiveVisitActionButtons(null, 'hi');
    if (buttons.kind !== 'buttons') throw new Error('expected buttons');
    expect(buttons.buttons.map((b) => b.id)).toEqual([
      'visit-reschedule',
      'browse-projects',
      'call-me',
    ]);
  });

  it('INVESTO-20260630-PROJECT-PROPERTY-MEDIA-ISOLATION does not fall back to child property media for project selection', async () => {
    (prisma.propertyProjectFile.findFirst as jest.Mock).mockResolvedValue(null);

    const brochure = await resolveProjectBrochureMediaComponent('co-1', 'proj-investo', 'investo');
    const hero = await resolveProjectHeroImageComponent('co-1', 'proj-investo', 'investo');

    expect(brochure).toBeNull();
    expect(hero).toBeNull();
    expect(prisma.property.findFirst).not.toHaveBeenCalled();
    expect(prisma.property.findMany).not.toHaveBeenCalled();
  });

  it('INVESTO-20260630-PROJECT-PROPERTY-MEDIA-ISOLATION attaches only project-level PDF and image files', async () => {
    (prisma.propertyProjectFile.findFirst as jest.Mock)
      .mockResolvedValueOnce({
        storageKey: 'companies/co-1/projects/proj-investo/brochure.pdf',
        mimeType: 'application/pdf',
        fileName: 'investo-brochure.pdf',
      })
      .mockResolvedValueOnce({
        storageKey: 'companies/co-1/projects/proj-investo/hero.webp',
        mimeType: 'image/webp',
        fileName: 'hero.webp',
      });

    const brochure = await resolveProjectBrochureMediaComponent('co-1', 'proj-investo', 'investo');
    const hero = await resolveProjectHeroImageComponent('co-1', 'proj-investo', 'investo');

    expect(storageService.getPublicUrl).toHaveBeenCalledWith('companies/co-1/projects/proj-investo/brochure.pdf');
    expect(storageService.getPublicUrl).toHaveBeenCalledWith('companies/co-1/projects/proj-investo/hero.webp');
    expect(resolveBrochureUrlForWhatsApp).toHaveBeenCalledWith(
      'https://storage.example/companies/co-1/projects/proj-investo/brochure.pdf',
    );
    expect(resolveStorageReferenceForWhatsApp).toHaveBeenCalledWith(
      'https://storage.example/companies/co-1/projects/proj-investo/hero.webp',
    );
    expect(brochure).toMatchObject({
      kind: 'media',
      mime: 'application/pdf',
      caption: 'investo',
    });
    expect(hero).toMatchObject({
      kind: 'media',
      mime: 'image/webp',
      caption: 'investo',
    });
    expect(prisma.property.findFirst).not.toHaveBeenCalled();
    expect(prisma.property.findMany).not.toHaveBeenCalled();
  });
});
