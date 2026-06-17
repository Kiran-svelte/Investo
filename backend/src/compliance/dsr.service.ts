import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';

import config from '../config';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { legalHoldService } from './legalHold.service';

function prismaClient(): any {
  return prisma as any;
}

export type DsrRequestType = 'export' | 'delete' | 'access';

export class DsrService {
  isEnabled(): boolean {
    return config.features.dsr === true;
  }

  async createRequest(input: {
    companyId: string;
    requestType: DsrRequestType;
    subjectPhone?: string;
    subjectEmail?: string;
    requestedBy: string;
  }) {
    if (!this.isEnabled()) {
      throw new Error('DSR feature is disabled');
    }

    return prismaClient().dataSubjectRequest.create({
      data: {
        companyId: input.companyId,
        requestType: input.requestType,
        subjectPhone: input.subjectPhone,
        subjectEmail: input.subjectEmail,
        requestedBy: input.requestedBy,
        status: 'pending',
      },
    });
  }

  async listRequests(companyId: string) {
    return prismaClient().dataSubjectRequest.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async processExport(requestId: string, companyId: string): Promise<string> {
    const request = await prismaClient().dataSubjectRequest.findFirst({
      where: { id: requestId, companyId },
    });
    if (!request) throw new Error('DSR request not found');

    await prismaClient().dataSubjectRequest.update({
      where: { id: requestId },
      data: { status: 'processing' },
    });

    const exportData = await this.buildExportPayload(companyId, request);
    const artifactPath = await this.writeExportZip(companyId, requestId, exportData);

    await prismaClient().dataSubjectRequest.update({
      where: { id: requestId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        artifactPath,
      },
    });

    return artifactPath;
  }

  async processDelete(requestId: string, companyId: string): Promise<void> {
    const request = await prismaClient().dataSubjectRequest.findFirst({
      where: { id: requestId, companyId, requestType: 'delete' },
    });
    if (!request) throw new Error('Delete DSR request not found');
    if (!request.subjectPhone) throw new Error('subject_phone required for delete');

    const lead = await prismaClient().lead.findFirst({
      where: { companyId, phone: request.subjectPhone },
    });
    if (!lead) throw new Error('Lead not found for subject phone');

    const onHold = await legalHoldService.isEntityOnHold(companyId, 'lead', lead.id);
    if (onHold) {
      await prismaClient().dataSubjectRequest.update({
        where: { id: requestId },
        data: { status: 'rejected' },
      });
      throw new Error('Legal hold blocks delete for this subject');
    }

    await prismaClient().dataSubjectRequest.update({
      where: { id: requestId },
      data: { status: 'processing' },
    });

    await this.anonymizeLead(lead.id, companyId);

    await prismaClient().dataSubjectRequest.update({
      where: { id: requestId },
      data: { status: 'completed', completedAt: new Date() },
    });
  }

  private async buildExportPayload(companyId: string, request: any) {
    const where: Record<string, unknown> = { companyId };
    if (request.subjectPhone) {
      where.phone = request.subjectPhone;
    }

    const [leads, visits, auditLogs] = await Promise.all([
      prismaClient().lead.findMany({ where }),
      prismaClient().visit.findMany({
        where: request.subjectPhone
          ? { companyId, lead: { phone: request.subjectPhone } }
          : { companyId },
      }),
      prismaClient().auditLog.findMany({
        where: { companyId },
        take: 5000,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      exported_at: new Date().toISOString(),
      company_id: companyId,
      request_id: request.id,
      leads,
      visits,
      audit_logs: auditLogs,
    };
  }

  private async writeExportZip(companyId: string, requestId: string, data: unknown): Promise<string> {
    const gzip = promisify(zlib.gzip);
    const dir = path.join(os.tmpdir(), 'investo-dsr', companyId);
    await fs.mkdir(dir, { recursive: true });
    const zipPath = path.join(dir, `${requestId}.export.json.gz`);

    const compressed = await gzip(Buffer.from(JSON.stringify(data, null, 2), 'utf8'));
    await fs.writeFile(zipPath, compressed);

    logger.info('DSR export written', { companyId, requestId, zipPath });
    return zipPath;
  }

  private async anonymizeLead(leadId: string, companyId: string): Promise<void> {
    await prismaClient().lead.update({
      where: { id: leadId },
      data: {
        customerName: 'Anonymized',
        email: null,
        notes: null,
        phone: `anon-${leadId.slice(0, 8)}`,
        metadata: { anonymized: true, anonymized_at: new Date().toISOString() },
      },
    });

    const conversations = await prismaClient().conversation.findMany({
      where: { companyId, leadId },
      select: { id: true },
    });

    for (const conv of conversations) {
      await prismaClient().message.updateMany({
        where: { conversationId: conv.id },
        data: { content: '[redacted]' },
      });
    }
  }
}

export const dsrService = new DsrService();
