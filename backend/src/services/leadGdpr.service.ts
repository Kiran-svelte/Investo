import { randomUUID } from 'crypto';
import prisma from '../config/prisma';
import { metadataToDto } from './leadMetadata.service';
import { deleteLeadPermanently, ResourceDeleteError } from './resourceDelete.service';

export class LeadGdprError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = 'LeadGdprError';
  }
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Export all personal data held for a lead (GDPR subject access request).
 */
export async function exportLeadPersonalData(companyId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId },
    include: {
      assignedAgent: { select: { id: true, name: true, email: true } },
      conversations: {
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      visits: {
        include: {
          property: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true } },
        },
        orderBy: { scheduledAt: 'asc' },
      },
    },
  });

  if (!lead) {
    throw new LeadGdprError('Lead not found', 404);
  }

  const auditTrail = await prisma.auditLog.findMany({
    where: { companyId, resourceType: 'leads', resourceId: leadId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const meta = metadataToDto(lead.metadata);

  return {
    exported_at: new Date().toISOString(),
    lead: {
      id: lead.id,
      customer_name: lead.customerName,
      phone: lead.phone,
      email: lead.email,
      budget_min: toNumber(lead.budgetMin),
      budget_max: toNumber(lead.budgetMax),
      location_preference: lead.locationPreference,
      property_type: lead.propertyType,
      source: lead.source,
      status: lead.status,
      notes: lead.notes,
      language: lead.language,
      lead_score: meta.lead_score ?? null,
      tags: meta.tags ?? [],
      source_detail: meta.source_detail ?? null,
      lost_reason: meta.lost_reason ?? null,
      assigned_agent: lead.assignedAgent,
      created_at: toIso(lead.createdAt),
      updated_at: toIso(lead.updatedAt),
      last_contact_at: toIso(lead.lastContactAt),
    },
    conversations: lead.conversations.map((conversation) => ({
      id: conversation.id,
      whatsapp_phone: conversation.whatsappPhone,
      status: conversation.status,
      language: conversation.language,
      stage: conversation.stage,
      created_at: toIso(conversation.createdAt),
      updated_at: toIso(conversation.updatedAt),
      messages: conversation.messages.map((message) => ({
        id: message.id,
        sender_type: message.senderType,
        content: message.content,
        language: message.language,
        status: message.status,
        created_at: toIso(message.createdAt),
      })),
    })),
    visits: lead.visits.map((visit) => ({
      id: visit.id,
      scheduled_at: toIso(visit.scheduledAt),
      duration_minutes: visit.durationMinutes,
      status: visit.status,
      notes: visit.notes,
      property: visit.property,
      agent: visit.agent,
      created_at: toIso(visit.createdAt),
      updated_at: toIso(visit.updatedAt),
    })),
    audit_trail: auditTrail.map((entry) => ({
      id: entry.id,
      action: entry.action,
      user_id: entry.userId,
      details: entry.details,
      created_at: toIso(entry.createdAt),
    })),
  };
}

/**
 * Permanently erase a lead and related personal data for GDPR right-to-erasure.
 */
export async function eraseLeadPersonalData(companyId: string, leadId: string): Promise<void> {
  try {
    await deleteLeadPermanently(companyId, leadId);
  } catch (err) {
    if (err instanceof ResourceDeleteError) {
      throw new LeadGdprError(err.message, err.statusCode);
    }
    throw err;
  }
}

/** Anonymize a lead in-place when hard delete is not desired (retained for tests). */
export async function anonymizeLeadRecord(companyId: string, leadId: string): Promise<void> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId } });
  if (!lead) {
    throw new LeadGdprError('Lead not found', 404);
  }

  const erasedPhone = `erased-${randomUUID().slice(0, 12)}`;

  await prisma.$transaction([
    prisma.message.deleteMany({
      where: { conversation: { companyId, leadId } },
    }),
    prisma.conversation.updateMany({
      where: { companyId, leadId },
      data: { whatsappPhone: erasedPhone },
    }),
    prisma.visit.updateMany({
      where: { companyId, leadId },
      data: { notes: null },
    }),
    prisma.lead.update({
      where: { id: leadId },
      data: {
        customerName: null,
        email: null,
        phone: erasedPhone,
        notes: null,
        locationPreference: null,
        metadata: {},
      },
    }),
  ]);
}
