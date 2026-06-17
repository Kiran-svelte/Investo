import config from '../config';
import prisma from '../config/prisma';
import logger from '../config/logger';

function prismaClient(): any {
  return prisma as any;
}

export class SandboxService {
  isEnabled(): boolean {
    return config.features.sandboxTenants === true;
  }

  async createSandbox(companyId: string, sandboxCompanyId: string) {
    if (!this.isEnabled()) {
      throw new Error('Sandbox tenants feature is disabled');
    }

    const row = await prismaClient().sandboxTenant.create({
      data: {
        companyId,
        sandboxCompanyId,
        piiScrubbed: true,
      },
    });

    if (config.features.sandboxNoRealPii === true) {
      await this.scrubSandboxPii(sandboxCompanyId);
    }

    return row;
  }

  async getSandbox(companyId: string) {
    return prismaClient().sandboxTenant.findUnique({ where: { companyId } });
  }

  async scrubSandboxPii(sandboxCompanyId: string): Promise<void> {
    await prismaClient().lead.updateMany({
      where: { companyId: sandboxCompanyId },
      data: {
        customerName: 'Sandbox User',
        email: null,
        notes: null,
        metadata: { sandbox: true, pii_scrubbed: true },
      },
    });

    logger.info('Sandbox PII scrubbed', { sandboxCompanyId });
  }
}

export const sandboxService = new SandboxService();
