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

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    env: 'development',
    whatsapp: {
      provider: 'greenapi',
      phoneNumberId: '',
      accessToken: '',
      verifyToken: '',
      apiUrl: 'https://graph.facebook.com/v18.0',
      dedupTtlSeconds: 300,
    },
    greenapi: {
      apiUrl: 'https://api.green-api.com',
      idInstance: 'id-1',
      apiTokenInstance: 'token-1',
      webhookUrlToken: 'webhook-token',
    },
  },
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

import { WhatsAppService } from '../../services/whatsapp.service';

describe('WhatsAppService GreenAPI company resolution (fail closed)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the mapped company when phoneNumberId matches settings.whatsapp.phoneNumberId (idInstance mapping)', async () => {
    const companyA = {
      id: 'a-company',
      name: 'A Co',
      whatsappPhone: null,
      settings: {
        whatsapp: {
          phoneNumberId: '110',
          accessToken: '',
          verifyToken: '',
        },
      },
    };

    const companyB = {
      id: 'b-company',
      name: 'B Co',
      whatsappPhone: null,
      settings: {
        whatsapp: {
          phoneNumberId: '111',
          accessToken: '',
          verifyToken: '',
        },
      },
    };

    mockPrisma.company.findMany.mockResolvedValue([companyB, companyA]);

    const service = new WhatsAppService();
    const result = await service.getCompanyByPhoneNumberId('110');

    expect(result).not.toBeNull();
    expect(result?.company.id).toBe('a-company');
  });

  it('returns null when no company is mapped for the GreenAPI instance (no fallback)', async () => {
    const companyA = {
      id: 'a-company',
      name: 'A Co',
      whatsappPhone: null,
      settings: {
        whatsapp: {
          phoneNumberId: '110',
          accessToken: '',
          verifyToken: '',
        },
      },
    };

    mockPrisma.company.findMany.mockResolvedValue([companyA]);

    const service = new WhatsAppService();
    const result = await service.getCompanyByPhoneNumberId('999');

    expect(result).toBeNull();
  });
});
