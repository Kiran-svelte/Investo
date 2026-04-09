/// <reference types="jest" />

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    whatsapp: {
      dedupTtlSeconds: 300,
    },
  },
}));

const getRedisMock = jest.fn();
jest.mock('../../config/redis', () => ({
  __esModule: true,
  getRedis: () => getRedisMock(),
}));

import { DeduplicationService } from '../../services/deduplication.service';

describe('DeduplicationService claim/release behavior', () => {
  let service: DeduplicationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    getRedisMock.mockReturnValue(null);
    service = new DeduplicationService(300);
    await service.clearAll();
  });

  test('claims a new message once and rejects second claim as duplicate', async () => {
    const firstClaim = await service.claimMessageProcessing('msg-1');
    const secondClaim = await service.claimMessageProcessing('msg-1');

    expect(firstClaim).toBe(true);
    expect(secondClaim).toBe(false);
  });

  test('allows retry after release', async () => {
    const firstClaim = await service.claimMessageProcessing('msg-2');
    expect(firstClaim).toBe(true);

    await service.release('msg-2');

    const secondClaim = await service.claimMessageProcessing('msg-2');
    expect(secondClaim).toBe(true);
  });
});
