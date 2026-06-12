import prisma from '../config/prisma';

export type StaffRescheduleRequestMeta = {
  staff_reschedule_visit_id?: string;
  staff_reschedule_agent_id?: string;
  staff_reschedule_requested_at?: string;
};

export function mergeLeadMetadataRaw(
  existing: unknown,
  patch: StaffRescheduleRequestMeta & Record<string, unknown>,
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  return { ...base, ...patch };
}

export async function readStaffRescheduleRequest(
  leadId: string,
): Promise<StaffRescheduleRequestMeta | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { metadata: true },
  });
  if (!lead?.metadata || typeof lead.metadata !== 'object' || Array.isArray(lead.metadata)) {
    return null;
  }
  const meta = lead.metadata as Record<string, unknown>;
  const visitId = typeof meta.staff_reschedule_visit_id === 'string'
    ? meta.staff_reschedule_visit_id
    : undefined;
  if (!visitId) return null;
  return {
    staff_reschedule_visit_id: visitId,
    staff_reschedule_agent_id:
      typeof meta.staff_reschedule_agent_id === 'string' ? meta.staff_reschedule_agent_id : undefined,
    staff_reschedule_requested_at:
      typeof meta.staff_reschedule_requested_at === 'string'
        ? meta.staff_reschedule_requested_at
        : undefined,
  };
}

export async function clearStaffRescheduleRequest(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { metadata: true } });
  if (!lead?.metadata || typeof lead.metadata !== 'object' || Array.isArray(lead.metadata)) {
    return;
  }
  const meta = { ...(lead.metadata as Record<string, unknown>) };
  delete meta.staff_reschedule_visit_id;
  delete meta.staff_reschedule_agent_id;
  delete meta.staff_reschedule_requested_at;
  await prisma.lead.update({ where: { id: leadId }, data: { metadata: meta } });
}
