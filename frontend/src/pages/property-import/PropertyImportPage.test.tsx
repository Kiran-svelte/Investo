/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PropertyImportPage from './PropertyImportPage';

const {
  navigateMock,
  getPropertyImportDraftMock,
  publishPropertyImportDraftMock,
  savePropertyImportDraftMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  getPropertyImportDraftMock: vi.fn(),
  publishPropertyImportDraftMock: vi.fn(),
  savePropertyImportDraftMock: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      role: 'company_admin',
      company_id: 'company-1',
    },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ draftId: 'draft-1' }),
  };
});

vi.mock('../../services/propertyImport', () => ({
  normalizePropertyImportDraft: (draft: unknown) => draft,
  cancelPropertyImportDraft: vi.fn(),
  confirmPropertyImportUpload: vi.fn(),
  createPropertyImportDraft: vi.fn(),
  getPropertyImportDraft: getPropertyImportDraftMock,
  inferPropertyImportAssetType: vi.fn(() => 'brochure'),
  isPropertyImportMimeTypeSupported: vi.fn(() => true),
  publishPropertyImportDraft: publishPropertyImportDraftMock,
  registerPropertyImportUpload: vi.fn(),
  retryPropertyImportDraft: vi.fn(),
  savePropertyImportDraft: savePropertyImportDraftMock,
  uploadPropertyImportFile: vi.fn(),
  PROPERTY_IMPORT_SUPPORTED_MIME_TYPES: ['application/pdf'],
}));

function createDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    companyId: 'company-1',
    createdByUserId: 'user-1',
    status: 'review_ready',
    extractionStatus: 'extracted',
    retryCount: 0,
    maxRetries: 3,
    draftData: {
      name: 'Skyline Towers',
      property_type: 'apartment',
      price_min: 8500000,
      price_max: 12500000,
      location_city: 'Bengaluru',
      bedrooms: 3,
      amenities: 'Pool, Gym',
      type_knowledge: {
        carpet_area_sqft: '1200 sq ft',
        bhk: '2 & 3 BHK',
        price: '₹1 Cr',
        floor_number: 'Mid rise',
        tower_name: 'Tower A',
        possession_date: 'Within 12 months',
        maintenance_fee: '₹3/sqft',
        facing: 'East',
        parking: '1 covered',
        amenities: 'Clubhouse',
        anything_else: 'Nothing else',
      },
    },
    mediaAssets: [{ id: 'm1', fileName: 'brochure.pdf', assetType: 'brochure', status: 'extracted', fileSize: 1000 }],
    extractionJobs: [],
    publishedProperty: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('PropertyImportPage simplified flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPropertyImportDraftMock.mockResolvedValue(createDraft());
    savePropertyImportDraftMock.mockImplementation(async (_id, body) =>
      createDraft({ draftData: { ...createDraft().draftData, ...(body.draft_data as object) } }),
    );
    publishPropertyImportDraftMock.mockResolvedValue({
      property: { id: 'property-1' },
      draft: createDraft({ status: 'published' }),
      knowledge_indexed: true,
    });
  });

  it('renders simplified steps and ready to go when knowledge complete', async () => {
    render(<PropertyImportPage />);

    expect(await screen.findByRole('heading', { name: 'Add a property' })).toBeInTheDocument();
    expect(screen.getByText('Knowledge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ready to go' })).toBeInTheDocument();
  });

  it('publishes when ready to go is clicked', async () => {
    const user = userEvent.setup();
    render(<PropertyImportPage />);

    await screen.findByRole('button', { name: 'Ready to go' });
    await user.click(screen.getByRole('button', { name: 'Ready to go' }));

    await waitFor(() => {
      expect(publishPropertyImportDraftMock).toHaveBeenCalledWith('draft-1', {});
    });
    expect(navigateMock).toHaveBeenCalledWith('/properties', { replace: true });
  });
});
