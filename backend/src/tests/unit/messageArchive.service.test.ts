/// <reference types="jest" />

const mockPrisma = {
  messageArchive: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: { features: { messageArchive: true } },
}));

import { messageArchiveService } from '../../governance/messageArchive.service';

describe('MessageArchiveService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.messageArchive.upsert.mockResolvedValue({
      id: 'arch-1',
      contentHash: messageArchiveService.hashContent('hello'),
    });
    mockPrisma.messageArchive.findUnique.mockImplementation(async () => ({
      contentHash: messageArchiveService.hashContent('hello'),
    }));
  });

  it('archives message with content hash', async () => {
    const archive = await messageArchiveService.archiveMessage({
      companyId: 'co-1',
      messageId: 'msg-1',
      content: 'hello',
    });
    expect(archive?.id).toBe('arch-1');
    expect(mockPrisma.messageArchive.upsert).toHaveBeenCalled();
  });

  it('verifies integrity for matching content', async () => {
    const valid = await messageArchiveService.verifyIntegrity('co-1', 'msg-1', 'hello');
    expect(valid).toBe(true);
  });

  it('fails integrity for tampered content', async () => {
    const valid = await messageArchiveService.verifyIntegrity('co-1', 'msg-1', 'changed');
    expect(valid).toBe(false);
  });
});
