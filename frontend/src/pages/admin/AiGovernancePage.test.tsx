/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AiGovernancePage from './AiGovernancePage';

const { tenantState, governanceMock } = vi.hoisted(() => ({
  tenantState: {
    targetCompanyId: null as string | null,
    targetCompanyName: null as string | null,
    isPlatformAdmin: true,
    setTargetCompany: vi.fn(),
    clearTargetCompany: vi.fn(),
  },
  governanceMock: {
    listAiReviewQueue: vi.fn(),
    listPromptVersions: vi.fn(),
    reviewAiQueueItem: vi.fn(),
  },
}));

vi.mock('../../context/TenantContext', () => ({
  useTenantContext: () => tenantState,
}));

vi.mock('../../services/governance', () => ({
  listAiReviewQueue: governanceMock.listAiReviewQueue,
  listPromptVersions: governanceMock.listPromptVersions,
  reviewAiQueueItem: governanceMock.reviewAiQueueItem,
}));

describe('AiGovernancePage tenant context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantState.targetCompanyId = null;
    tenantState.targetCompanyName = null;
    tenantState.isPlatformAdmin = true;
    governanceMock.listAiReviewQueue.mockResolvedValue({
      items: [],
      enabled: true,
      threshold: 70,
    });
    governanceMock.listPromptVersions.mockResolvedValue({
      versions: [],
      enabled: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('blocks platform admin AI governance calls until an agency is selected', () => {
    render(
      <MemoryRouter>
        <AiGovernancePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /select an agency before opening ai governance/i })).toBeInTheDocument();
    expect(governanceMock.listAiReviewQueue).not.toHaveBeenCalled();
    expect(governanceMock.listPromptVersions).not.toHaveBeenCalled();
  });
});
