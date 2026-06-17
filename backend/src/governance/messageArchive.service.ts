import { createHash } from 'crypto';

import config from '../config';
import prisma from '../config/prisma';

function prismaClient(): any {
  return prisma as any;
}

export class MessageArchiveService {
  isEnabled(): boolean {
    return config.features.messageArchive === true;
  }

  hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  buildStorageKey(companyId: string, messageId: string): string {
    return `archives/${companyId}/${messageId}.json`;
  }

  async archiveMessage(input: {
    companyId: string;
    messageId: string;
    content: string;
  }) {
    if (!this.isEnabled()) return null;

    const contentHash = this.hashContent(input.content);
    const storageKey = this.buildStorageKey(input.companyId, input.messageId);

    return prismaClient().messageArchive.upsert({
      where: {
        companyId_messageId: {
          companyId: input.companyId,
          messageId: input.messageId,
        },
      },
      create: {
        companyId: input.companyId,
        messageId: input.messageId,
        contentHash,
        storageKey,
      },
      update: {
        contentHash,
        storageKey,
      },
    });
  }

  async getArchive(companyId: string, messageId: string) {
    return prismaClient().messageArchive.findUnique({
      where: {
        companyId_messageId: { companyId, messageId },
      },
    });
  }

  async verifyIntegrity(companyId: string, messageId: string, content: string): Promise<boolean> {
    const row = await this.getArchive(companyId, messageId);
    if (!row) return false;
    return row.contentHash === this.hashContent(content);
  }
}

export const messageArchiveService = new MessageArchiveService();
