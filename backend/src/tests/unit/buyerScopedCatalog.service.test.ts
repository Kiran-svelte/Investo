const mockPrisma = {
  property: { findMany: jest.fn() },
  propertyProject: { count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../services/propertyKnowledge.service', () => ({
  searchPropertyKnowledge: jest.fn().mockResolvedValue([]),
}));

import config from '../../config';
import { resolveBuyerAiPropertyCatalog } from '../../services/buyer/buyerScopedCatalog.service';
import type { BuyerConversationFocus } from '../../services/buyer/buyerConversationFocus.service';

const emptyFocus: BuyerConversationFocus = {
  focusedProjectId: null,
  focusedPropertyId: null,
  recommendedPropertyIds: [],
  allowedPropertyIds: [],
};

function makeProperty(id: string, projectId: string | null = null) {
  return {
    id,
    companyId: 'company-1',
    projectId,
    name: `Property ${id}`,
    status: 'available',
  };
}

describe('buyerScopedCatalog.service', () => {
  const originalFlag = config.features.scopedAiCatalog;
  const originalRag = config.features.fullImportKnowledgeIndexing;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.property.findMany.mockReset();
    mockPrisma.propertyProject.count.mockReset();
    mockPrisma.propertyProject.findFirst.mockReset();
    mockPrisma.propertyProject.findMany.mockReset();
    config.features.scopedAiCatalog = false;
    config.features.fullImportKnowledgeIndexing = false;
  });

  afterAll(() => {
    config.features.scopedAiCatalog = originalFlag;
    config.features.fullImportKnowledgeIndexing = originalRag;
  });

  test('flag OFF uses unscoped take 20 fallback when no explicit ids', async () => {
    mockPrisma.property.findMany.mockResolvedValue(Array.from({ length: 20 }, (_, i) => makeProperty(`p-${i}`)));

    const result = await resolveBuyerAiPropertyCatalog({
      companyId: 'company-1',
      focus: emptyFocus,
      resolvedPropertyId: null,
      neverSayNoPropertyIds: [],
      conversionAlternativeIds: [],
    });

    expect(result.catalogMode).toBe('legacy_fallback');
    expect(result.properties).toHaveLength(20);
    expect(mockPrisma.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
  });

  describe('flag ON', () => {
    beforeEach(() => {
      config.features.scopedAiCatalog = true;
    });

    test('focused project catalog caps at 15 and stays in project', async () => {
      const projectProps = Array.from({ length: 12 }, (_, i) => makeProperty(`sunset-${i}`, 'project-sunset'));
      mockPrisma.property.findMany.mockResolvedValue(projectProps);

      const result = await resolveBuyerAiPropertyCatalog({
        companyId: 'company-1',
        focus: { ...emptyFocus, focusedProjectId: 'project-sunset' },
        resolvedPropertyId: null,
        neverSayNoPropertyIds: [],
        conversionAlternativeIds: [],
      });

      expect(result.catalogMode).toBe('project');
      expect(result.properties.length).toBeLessThanOrEqual(15);
      expect(result.properties.every((p) => p.projectId === 'project-sunset')).toBe(true);
    });

    test('neverSayNo ids included even outside project scope', async () => {
      mockPrisma.property.findMany.mockResolvedValue([
        makeProperty('other-project-unit', 'project-other'),
      ]);

      const result = await resolveBuyerAiPropertyCatalog({
        companyId: 'company-1',
        focus: { ...emptyFocus, focusedProjectId: 'project-sunset' },
        resolvedPropertyId: null,
        neverSayNoPropertyIds: ['other-project-unit'],
        conversionAlternativeIds: [],
      });

      expect(result.catalogMode).toBe('focused');
      expect(result.properties.map((p) => p.id)).toEqual(['other-project-unit']);
    });

    test('single-project company loads full project catalog', async () => {
      mockPrisma.propertyProject.count.mockResolvedValue(1);
      mockPrisma.propertyProject.findFirst.mockResolvedValue({ id: 'only-project' });
      mockPrisma.property.findMany.mockResolvedValue([
        makeProperty('a', 'only-project'),
        makeProperty('b', 'only-project'),
      ]);

      const result = await resolveBuyerAiPropertyCatalog({
        companyId: 'company-1',
        focus: emptyFocus,
        resolvedPropertyId: null,
        neverSayNoPropertyIds: [],
        conversionAlternativeIds: [],
      });

      expect(result.catalogMode).toBe('single_project');
      expect(result.properties).toHaveLength(2);
    });

    test('multi-project empty focus uses discovery projects not unscoped 20', async () => {
      mockPrisma.propertyProject.count.mockResolvedValue(3);
      mockPrisma.propertyProject.findMany.mockResolvedValue([
        { id: 'p1' },
        { id: 'p2' },
        { id: 'p3' },
      ]);
      mockPrisma.property.findMany.mockResolvedValue([
        makeProperty('x', 'p1'),
        makeProperty('y', 'p2'),
      ]);

      const result = await resolveBuyerAiPropertyCatalog({
        companyId: 'company-1',
        focus: emptyFocus,
        resolvedPropertyId: null,
        neverSayNoPropertyIds: [],
        conversionAlternativeIds: [],
      });

      expect(result.catalogMode).toBe('recommended');
      expect(result.properties.length).toBe(2);
      expect(mockPrisma.property.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });
  });
});
