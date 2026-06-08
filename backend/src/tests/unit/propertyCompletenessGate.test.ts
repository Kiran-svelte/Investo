import { propertyCompletenessGate } from '../../middleware/propertyCompletenessGate';
import { getUserCatalogCompletenessBlock } from '../../services/propertyCompleteness.service';

jest.mock('../../services/propertyCompleteness.service', () => ({
  getUserCatalogCompletenessBlock: jest.fn(),
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function mockReq(method: string, url: string, user: Record<string, unknown> = {}) {
  return {
    method,
    originalUrl: url,
    path: url,
    user: { id: 'user-1', role: 'company_admin', company_id: 'co-1', ...user },
  } as any;
}

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('propertyCompletenessGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getUserCatalogCompletenessBlock as jest.Mock).mockResolvedValue({
      promptMessage: 'Finish catalog',
      reasons: ['missing price'],
    });
  });

  it('allows PATCH visit status updates when catalog is incomplete', async () => {
    const req = mockReq('PATCH', '/api/visits/visit-123/status');
    const res = mockRes();
    const next = jest.fn();

    await propertyCompletenessGate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(getUserCatalogCompletenessBlock).not.toHaveBeenCalled();
  });

  it('blocks POST new visit creation when catalog is incomplete', async () => {
    const req = mockReq('POST', '/api/visits');
    const res = mockRes();
    const next = jest.fn();

    await propertyCompletenessGate(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(423);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'property_catalog_incomplete' }),
    );
  });
});
