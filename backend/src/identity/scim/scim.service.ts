import { v4 as uuidv4 } from 'uuid';

import prisma from '../../config/prisma';
import { normalizeAuthEmail } from '../../services/auth.service';
import { deactivateScimUser } from '../sessionPolicy.service';

function prismaClient(): any {
  return prisma as any;
}

function scimUserResource(user: any): Record<string, unknown> {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: user.externalId || user.id,
    externalId: user.externalId || user.id,
    userName: user.email,
    name: { formatted: user.name, givenName: user.name },
    emails: [{ value: user.email, primary: true }],
    active: user.status === 'active',
    meta: {
      resourceType: 'User',
      created: user.createdAt,
      lastModified: user.updatedAt,
    },
  };
}

export class ScimService {
  async listUsers(companyId: string, startIndex = 1, count = 100) {
    const rows = await prismaClient().user.findMany({
      where: { companyId, authProvider: { in: ['scim', 'sso', 'local'] } },
      orderBy: { createdAt: 'asc' },
      skip: Math.max(0, startIndex - 1),
      take: count,
    });

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: rows.length,
      startIndex,
      itemsPerPage: count,
      Resources: rows.map(scimUserResource),
    };
  }

  async createUser(companyId: string, body: any) {
    const email = normalizeAuthEmail(body.userName || body.emails?.[0]?.value);
    const externalId = String(body.externalId || body.id || uuidv4());
    const name = body.name?.formatted || body.displayName || email.split('@')[0];

    const existing = await prismaClient().user.findFirst({
      where: { companyId, OR: [{ email }, { externalId }] },
    });
    if (existing) {
      const err = new Error('User already exists');
      (err as any).statusCode = 409;
      throw err;
    }

    const user = await prismaClient().user.create({
      data: {
        id: uuidv4(),
        companyId,
        email,
        name,
        externalId,
        authProvider: 'scim',
        role: 'viewer',
        status: body.active === false ? 'inactive' : 'active',
      },
    });

    await prismaClient().scimProvisioningEvent.create({
      data: {
        companyId,
        action: 'scim_user_created',
        externalId,
        userId: user.id,
        payload: body,
      },
    });

    return scimUserResource(user);
  }

  async patchUser(companyId: string, externalOrId: string, body: any) {
    const user = await this.findUser(companyId, externalOrId);
    if (!user) {
      const err = new Error('User not found');
      (err as any).statusCode = 404;
      throw err;
    }

    const activeOp = body.Operations?.find((op: any) => op.op === 'replace' && op.path === 'active');
    const emailOp = body.Operations?.find((op: any) => op.op === 'replace' && op.path === 'userName');

    const updates: Record<string, unknown> = {};
    if (emailOp?.value) updates.email = normalizeAuthEmail(emailOp.value);
    if (activeOp !== undefined) {
      updates.status = activeOp.value === false || activeOp.value === 'False' ? 'inactive' : 'active';
    }

    const updated = await prismaClient().user.update({
      where: { id: user.id },
      data: updates,
    });

    if (updates.status === 'inactive') {
      await deactivateScimUser({ companyId, externalId: updated.externalId || updated.id });
    }

    return scimUserResource(updated);
  }

  async deleteUser(companyId: string, externalOrId: string) {
    const user = await this.findUser(companyId, externalOrId);
    if (!user) {
      const err = new Error('User not found');
      (err as any).statusCode = 404;
      throw err;
    }

    await deactivateScimUser({
      companyId,
      externalId: user.externalId || user.id,
    });
  }

  private async findUser(companyId: string, externalOrId: string) {
    return prismaClient().user.findFirst({
      where: {
        companyId,
        OR: [{ externalId: externalOrId }, { id: externalOrId }],
      },
    });
  }
}

export const scimService = new ScimService();
