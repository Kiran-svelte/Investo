/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PropertyImportPage from './PropertyImportPage';

const {
  navigateMock,
  getPropertyImportDraftMock,
  savePropertyImportDraftMock,
  publishPropertyImportDraftMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  getPropertyImportDraftMock: vi.fn(),
  savePropertyImportDraftMock: vi.fn(),
  publishPropertyImportDraftMock: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      name: 'Admin User',
      email: 'admin@example.com',
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
  cancelPropertyImportDraft: vi.fn(),
  confirmPropertyImportUpload: vi.fn(),
  createPropertyImportDraft: vi.fn(),
  getPropertyImportDraft: getPropertyImportDraftMock,
  inferPropertyImportAssetType: vi.fn(() => 'image'),
  isPropertyImportMimeTypeSupported: vi.fn(() => true),
  publishPropertyImportDraft: publishPropertyImportDraftMock,
  registerPropertyImportUpload: vi.fn(),
  retryPropertyImportDraft: vi.fn(),
  savePropertyImportDraft: savePropertyImportDraftMock,
  uploadPropertyImportFile: vi.fn(),
  PROPERTY_IMPORT_ASSET_TYPE_LABELS: {
    image: 'Image',
    brochure: 'Brochure',
    video: 'Video',
  },
  PROPERTY_IMPORT_SUPPORTED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4'],
}));

function createDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    companyId: 'company-1',
    createdByUserId: 'user-1',
    reviewedByUserId: null,
    publishedPropertyId: null,
    status: 'review_ready',
    extractionStatus: 'extracted',
    retryCount: 0,
    maxRetries: 3,
    failureReason: null,
    draftData: {
      name: 'Skyline Towers',
      import_mapping: {
        source_type: 'brochure',
        profile_name: 'default-profile',
        field_mappings: [
          {
            source_field: 'project_name',
            target_field: 'name',
            confidence: 0.7,
            required: true,
            label: 'Project name',
            notes: 'Brochure heading',
          },
        ],
        review_settings: {
          confidence_threshold: 0.75,
          low_confidence_threshold: 0.55,
          require_human_review: true,
        },
      },
      import_review: {
        status: 'needs_review',
        confidence_hints: [
          {
            field: 'name',
            confidence: 0.7,
            source_field: 'project_name',
            note: 'Low-confidence OCR mapping',
          },
        ],
      },
    },
    reviewNotes: null,
    extractionRequestedAt: null,
    reviewedAt: null,
    publishedAt: null,
    cancelledAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mediaAssets: [],
    extractionJobs: [],
    publishedProperty: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('PropertyImportPage review workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPropertyImportDraftMock.mockResolvedValue(createDraft());
    savePropertyImportDraftMock.mockResolvedValue(createDraft({
      status: 'publish_ready',
      draftData: {
        ...createDraft().draftData,
        import_review: {
          status: 'approved',
          confidence_hints: [],
        },
      },
    }));
    publishPropertyImportDraftMock.mockResolvedValue({
      property: { id: 'property-1', name: 'Skyline Towers' },
      draft: createDraft({ status: 'published', publishedPropertyId: 'property-1' }),
      alreadyPublished: false,
    });
  });

  it('renders review controls and mapping editor for visual coverage', async () => {
    render(<PropertyImportPage />);

    expect(await screen.findByRole('heading', { name: 'Review draft details' })).toBeInTheDocument();
    expect(screen.getByText('Mapping profile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save review' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish property' })).toBeInTheDocument();
  });

  it('handles save interaction with loading state and double-click prevention', async () => {
    const user = userEvent.setup();

    let resolveSave: (value: unknown) => void;
    const savePromise = new Promise((resolve) => {
      resolveSave = resolve;
    });

    savePropertyImportDraftMock.mockReturnValueOnce(savePromise);

    render(<PropertyImportPage />);

    await screen.findByRole('heading', { name: 'Review draft details' });

    const approveCheckbox = screen.getByLabelText('Approve this review and mark the draft ready to publish');
    await user.click(approveCheckbox);

    const saveButton = screen.getByRole('button', { name: 'Save review' });
    await user.click(saveButton);

    expect(savePropertyImportDraftMock).toHaveBeenCalledTimes(1);
    expect(savePropertyImportDraftMock).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({
        mark_publish_ready: true,
      }),
    );
    expect(saveButton).toBeDisabled();

    await user.click(saveButton);
    expect(savePropertyImportDraftMock).toHaveBeenCalledTimes(1);

    resolveSave!(createDraft({
      status: 'publish_ready',
      draftData: {
        ...createDraft().draftData,
        import_review: {
          status: 'approved',
          confidence_hints: [],
        },
      },
    }));

    await waitFor(() => {
      expect(screen.getByText('This draft is approved for publishing.')).toBeInTheDocument();
    });
  });

  it('shows error state when save fails', async () => {
    const user = userEvent.setup();
    savePropertyImportDraftMock.mockRejectedValueOnce(new Error('Save failed for network timeout'));

    render(<PropertyImportPage />);

    await screen.findByRole('heading', { name: 'Review draft details' });

    const saveButton = screen.getByRole('button', { name: 'Save review' });
    await user.click(saveButton);

    expect(await screen.findByText('Save failed for network timeout')).toBeInTheDocument();
    expect(publishPropertyImportDraftMock).not.toHaveBeenCalled();
  });

  it('persists approval before publish and navigates after successful publish', async () => {
    const user = userEvent.setup();

    render(<PropertyImportPage />);

    await screen.findByRole('heading', { name: 'Review draft details' });

    const approveCheckbox = screen.getByLabelText('Approve this review and mark the draft ready to publish');
    await user.click(approveCheckbox);

    const publishButton = screen.getByRole('button', { name: 'Publish property' });
    await user.click(publishButton);

    await waitFor(() => {
      expect(savePropertyImportDraftMock).toHaveBeenCalledTimes(1);
      expect(publishPropertyImportDraftMock).toHaveBeenCalledTimes(1);
    });

    expect(savePropertyImportDraftMock).toHaveBeenCalledWith(
      'draft-1',
      expect.objectContaining({
        mark_publish_ready: true,
      }),
    );

    expect(navigateMock).toHaveBeenCalledWith('/properties', { replace: true });
  });
});
