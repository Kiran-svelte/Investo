import config from '../config';
import prisma from '../config/prisma';

function prismaClient(): any {
  return prisma as any;
}

export class PromptVersionService {
  isEnabled(): boolean {
    return config.features.promptVersioning === true;
  }

  async createVersion(input: { name: string; version: string; content: string; status?: string }) {
    return prismaClient().promptVersion.create({
      data: {
        name: input.name,
        version: input.version,
        content: input.content,
        status: input.status || 'draft',
      },
    });
  }

  async listVersions(name?: string) {
    return prismaClient().promptVersion.findMany({
      where: name ? { name } : undefined,
      orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async activate(name: string, version: string) {
    await prismaClient().promptVersion.updateMany({
      where: { name, status: 'active' },
      data: { status: 'archived' },
    });
    return prismaClient().promptVersion.update({
      where: { name_version: { name, version } },
      data: { status: 'active' },
    });
  }

  async getActive(name: string) {
    return prismaClient().promptVersion.findFirst({
      where: { name, status: 'active' },
    });
  }
}

export const promptVersionService = new PromptVersionService();
