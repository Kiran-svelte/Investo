import logger from '../config/logger';

export const ATTENDANCE_BUTTON_IDS = {
  yes: 'attendance-yes',
  no: 'attendance-no',
  reschedule: 'attendance-reschedule',
} as const;

export type AttendanceVisitInfo = {
  id: string;
  companyId: string;
  scheduledAt: Date;
  customerName?: string | null;
  propertyName?: string | null;
};

export type AttendanceAgentInfo = {
  phone: string;
  companyId: string;
};

/**
 * Map attendance interactive button IDs to confirmation keywords.
 */
export function resolveAttendanceButtonCommand(interactiveId?: string | null): string | null {
  if (!interactiveId) return null;
  switch (interactiveId) {
    case ATTENDANCE_BUTTON_IDS.yes:
      return 'yes';
    case ATTENDANCE_BUTTON_IDS.no:
      return 'no';
    case ATTENDANCE_BUTTON_IDS.reschedule:
      return 'reschedule';
    default:
      return null;
  }
}

export function isAttendanceInteractiveId(interactiveId?: string | null): boolean {
  return Boolean(resolveAttendanceButtonCommand(interactiveId));
}

function formatDateIST(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatTimeIST(date: Date): string {
  return date.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function buildAttendanceCheckBody(visit: AttendanceVisitInfo): string {
  return [
    '*Attendance Check Required*',
    `Visit: ${visit.customerName ?? 'Unknown'} — ${visit.propertyName ?? 'TBD'}`,
    `Scheduled: ${formatDateIST(visit.scheduledAt)} ${formatTimeIST(visit.scheduledAt)}`,
    '',
    'Did the customer attend?',
  ].join('\n');
}

export function buildAttendanceCheckFallbackText(visit: AttendanceVisitInfo): string {
  return [
    buildAttendanceCheckBody(visit),
    'Reply *YES* if they came ✅',
    'Reply *NO* if they didn\'t ❌',
  ].join('\n');
}

/**
 * Send attendance check with Meta interactive buttons; falls back to plain text on failure.
 */
export async function sendAttendanceCheck(
  visit: AttendanceVisitInfo,
  agent: AttendanceAgentInfo,
): Promise<void> {
  const body = buildAttendanceCheckBody(visit);
  const buttons = [
    { id: ATTENDANCE_BUTTON_IDS.yes, title: 'Yes, attended' },
    { id: ATTENDANCE_BUTTON_IDS.no, title: 'No, no-show' },
    { id: ATTENDANCE_BUTTON_IDS.reschedule, title: 'Reschedule' },
  ];

  try {
    const { whatsappService } = await import('./whatsapp.service');
    const sent = await whatsappService.sendCompanyInteractiveButtons(
      agent.phone,
      agent.companyId,
      body,
      buttons,
      'Attendance check',
      'Tap to confirm outcome',
    );
    if (sent) return;
  } catch (err: unknown) {
    logger.warn('Attendance interactive send failed, using text fallback', {
      visitId: visit.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const { whatsappService } = await import('./whatsapp.service');
  await whatsappService.sendCompanyTextMessage(
    agent.phone,
    buildAttendanceCheckFallbackText(visit),
    agent.companyId,
  );
}
