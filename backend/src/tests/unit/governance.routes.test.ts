/// <reference types="jest" />

import express from 'express';
import request from 'supertest';

const mockUser = {
  id: 'user-1',
  company_id: 'company-own',
  companyId: 'company-own',
  email: 'admin@example.com',
  role: 'company_admin',
  name: 'Admin',
};

const mockPromptVersionService = {
  listVersions: jest.fn(),
  isEnabled: jest.fn(),
  createVersion: jest.fn(),
  activate: jest.fn(),
};

const mockAiReviewQueueService = {
  listPending: jest.fn(),
  isEnabled: jest.fn(),
  getRiskThreshold: jest.fn(),
  review: jest.fn(),
};

jest.mock('../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = mockUser;
    next();
  },
}));

jest.mock('../../middleware/rbac', () => ({
  hasRole: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    features: {
      aiReviewQueue: true,
      messageArchive: true,
      promptVersioning: true,
    },
  },
}));

jest.mock('../../governance/promptVersion.service', () => ({
  promptVersionService: mockPromptVersionService,
}));

jest.mock('../../governance/aiReviewQueue.service', () => ({
  aiReviewQueueService: mockAiReviewQueueService,
}));

jest.mock('../../governance/messageArchive.service', () => ({
  messageArchiveService: {
    archiveMessage: jest.fn(),
    verifyIntegrity: jest.fn(),
  },
}));

import governanceRoutes from '../../governance/governance.routes';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/governance', governanceRoutes);
  return app;
}

describe('governance routes tenant context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.id = 'user-1';
    mockUser.company_id = 'company-own';
    mockUser.companyId = 'company-own';
    mockUser.role = 'company_admin';
    mockAiReviewQueueService.listPending.mockResolvedValue([]);
    mockAiReviewQueueService.isEnabled.mockReturnValue(true);
    mockAiReviewQueueService.getRiskThreshold.mockReturnValue(70);
    mockAiReviewQueueService.review.mockResolvedValue({ count: 1 });
    mockPromptVersionService.listVersions.mockResolvedValue([]);
    mockPromptVersionService.isEnabled.mockReturnValue(true);
  });

  it('uses the authenticated company for company admins', async () => {
    const res = await request(makeApp()).get('/api/governance/ai-review-queue');

    expect(res.status).toBe(200);
    expect(mockAiReviewQueueService.listPending).toHaveBeenCalledWith('company-own');
  });

  it('requires target_company_id for platform admins', async () => {
    mockUser.role = 'super_admin';

    const res = await request(makeApp()).get('/api/governance/ai-review-queue');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('target_company_id');
    expect(mockAiReviewQueueService.listPending).not.toHaveBeenCalled();
  });

  it('uses selected target_company_id for platform admin review queue actions', async () => {
    mockUser.role = 'super_admin';

    const res = await request(makeApp())
      .post('/api/governance/ai-review-queue/review-1/review?target_company_id=company-target')
      .send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(mockAiReviewQueueService.review).toHaveBeenCalledWith(
      'review-1',
      'company-target',
      'user-1',
      'approved',
    );
  });
});
