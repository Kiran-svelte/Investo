/// <reference types="jest" />

const mockPrisma = {
  company: {
    findMany: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('WhatsAppService Meta company resolution (deterministic + fail closed)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('fails closed in production when no company is mapped for the incoming phoneNumberId', async () => {
    jest.doMock('../../config', () => ({
      __esModule: true,
      default: {
        env: 'production',
        whatsapp: {
          provider: 'meta',
          phoneNumberId: '',
          accessToken: 'global-token',
          verifyToken: 'verify-token',
          apiUrl: 'https://graph.facebook.com/v18.0',
          dedupTtlSeconds: 300,
        },
      },
    }));

    const companyA = {
      id: 'a-company',
      name: 'A Co',
      whatsappPhone: null,
      settings: { whatsapp: { phoneNumberId: 'mapped-1', accessToken: '', verifyToken: '' } },
    };

    const companyB = {
      id: 'b-company',
      name: 'B Co',
      whatsappPhone: null,
      settings: { whatsapp: { phoneNumberId: 'mapped-2', accessToken: '', verifyToken: '' } },
    };

    mockPrisma.company.findMany.mockResolvedValue([companyA, companyB]);

    const { WhatsAppService } = await import('../../services/whatsapp.service');
    const service = new WhatsAppService();

    const result = await service.getCompanyByPhoneNumberId('unmapped');
    expect(result).toBeNull();
  });

  it('allows a single-company fallback in non-production only when exactly one active company exists', async () => {
    jest.doMock('../../config', () => ({
      __esModule: true,
      default: {
        env: 'development',
        whatsapp: {
          provider: 'meta',
          phoneNumberId: '',
          accessToken: 'global-token',
          verifyToken: 'verify-token',
          apiUrl: 'https://graph.facebook.com/v18.0',
          dedupTtlSeconds: 300,
        },
      },
    }));

    const onlyCompany = {
      id: 'only-company',
      name: 'Only Co',
      whatsappPhone: null,
      settings: { whatsapp: { phoneNumberId: 'mapped-1', accessToken: '', verifyToken: '' } },
    };

    mockPrisma.company.findMany.mockResolvedValue([onlyCompany]);

    const { WhatsAppService } = await import('../../services/whatsapp.service');
    const service = new WhatsAppService();

    const result = await service.getCompanyByPhoneNumberId('unmapped');
    expect(result).not.toBeNull();
    expect(result?.company?.id).toBe('only-company');
  });

  it('fails closed in non-production when more than one active company exists and phoneNumberId is unmapped', async () => {
    jest.doMock('../../config', () => ({
      __esModule: true,
      default: {
        env: 'development',
        whatsapp: {
          provider: 'meta',
          phoneNumberId: '',
          accessToken: 'global-token',
          verifyToken: 'verify-token',
          apiUrl: 'https://graph.facebook.com/v18.0',
          dedupTtlSeconds: 300,
        },
      },
    }));

    const companyA = {
      id: 'a-company',
      name: 'A Co',
      whatsappPhone: null,
      settings: { whatsapp: { phoneNumberId: 'mapped-1', accessToken: '', verifyToken: '' } },
    };

    const companyB = {
      id: 'b-company',
      name: 'B Co',
      whatsappPhone: null,
      settings: { whatsapp: { phoneNumberId: 'mapped-2', accessToken: '', verifyToken: '' } },
    };

    mockPrisma.company.findMany.mockResolvedValue([companyA, companyB]);

    const { WhatsAppService } = await import('../../services/whatsapp.service');
    const service = new WhatsAppService();

    const result = await service.getCompanyByPhoneNumberId('unmapped');
    expect(result).toBeNull();
  });

  it('fails closed when more than one active company is mapped to the same incoming phoneNumberId (duplicate mapping)', async () => {
    jest.doMock('../../config', () => ({
      __esModule: true,
      default: {
        env: 'development',
        whatsapp: {
          provider: 'meta',
          phoneNumberId: '',
          accessToken: 'global-token',
          verifyToken: 'verify-token',
          apiUrl: 'https://graph.facebook.com/v18.0',
          dedupTtlSeconds: 300,
        },
      },
    }));

    const companyA = {
      id: 'a-company',
      name: 'A Co',
      whatsappPhone: null,
      settings: { whatsapp: { phoneNumberId: 'dup', accessToken: '', verifyToken: '' } },
    };

    const companyB = {
      id: 'b-company',
      name: 'B Co',
      whatsappPhone: null,
      settings: { whatsapp: { phoneNumberId: 'dup', accessToken: '', verifyToken: '' } },
    };

    mockPrisma.company.findMany.mockResolvedValue([companyA, companyB]);

    const { WhatsAppService } = await import('../../services/whatsapp.service');
    const service = new WhatsAppService();

    const result = await service.getCompanyByPhoneNumberId('dup');
    expect(result).toBeNull();
  });
});
