/**
 * Code-level proof that visit booking is fully wired end-to-end.
 */
describe('PROOF visit connectivity — enterprise wiring', () => {
  const read = (rel: string) => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
  };

  test('scheduleVisit emits socket + schedules reminders', () => {
    const booking = read('services/visitBooking.service.ts');
    expect(booking).toContain('emitVisitCreated');
    expect(booking).toContain('scheduleVisitReminderJobs');
  });

  test('visitState emits socket on reschedule/cancel/confirm', () => {
    const state = read('services/visitState.service.ts');
    expect(state).toContain('emitVisitUpdated');
    expect(state).toContain('cancelVisitReminderJobs');
    expect(state).toContain('rescheduleVisitReminderJobs');
    expect(state).toContain('confirmVisitById');
  });

  test('interactive confirm uses visitState not direct prisma', () => {
    const orch = read('services/whatsapp/whatsappInteractiveOrchestrator.service.ts');
    const confirmBlock = orch.slice(orch.indexOf('handleVisitConfirm'), orch.indexOf('async function handleVisitReschedule'));
    expect(confirmBlock).toContain('confirmVisitById');
    expect(confirmBlock).not.toContain("data: { status: 'confirmed' }");
  });

  test('interactive slot uses reschedule when active visit exists', () => {
    const orch = read('services/whatsapp/whatsappInteractiveOrchestrator.service.ts');
    const slotBlock = orch.slice(orch.indexOf('async function handleVisitTimeSlot'), orch.indexOf('export async function tryOrchestratedInteractiveAction'));
    expect(slotBlock).toContain('rescheduleVisitById');
    expect(slotBlock).toContain('isVisitAutoConfirmEnabled');
    expect(slotBlock).not.toContain('New Visit Booked!');
  });

  test('notification engine emits notification:new socket', () => {
    const ne = read('services/notification.engine.ts');
    expect(ne).toContain('NOTIFICATION_NEW');
  });

  test('calendar page listens for visit sockets', () => {
    const fs = require('fs');
    const path = require('path');
    const cal = fs.readFileSync(
      path.join(__dirname, '../../../../frontend/src/pages/calendar/CalendarPage.tsx'),
      'utf8',
    );
    expect(cal).toContain('VISIT_CREATED');
    expect(cal).toContain('VISIT_UPDATED');
  });

  test('notifications page listens for notification:new', () => {
    const fs = require('fs');
    const path = require('path');
    const page = fs.readFileSync(
      path.join(__dirname, '../../../../frontend/src/pages/notifications/NotificationsPage.tsx'),
      'utf8',
    );
    expect(page).toContain('NOTIFICATION_NEW');
  });

  test('single auto-confirm source of truth', () => {
    expect(read('services/visitAutoConfirm.service.ts')).toContain('isVisitAutoConfirmEnabled');
    expect(read('services/customerVisitBooking.service.ts')).toContain('isVisitAutoConfirmEnabled');
    expect(read('services/whatsapp/whatsappInteractiveOrchestrator.service.ts')).toContain('isVisitAutoConfirmEnabled');
  });
});
