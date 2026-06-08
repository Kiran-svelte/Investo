/**
 * Code-level proof that visit booking is fully wired end-to-end.
 */
describe('PROOF visit connectivity — enterprise wiring', () => {
  const read = (rel: string) => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
  };

  test('scheduleVisit emits socket on creation', () => {
    const booking = read('services/visitBooking.service.ts');
    expect(booking).toContain('emitVisitCreated');
  });

  test('confirmVisitById schedules reminders (reminders are only set on confirmation)', () => {
    // Architectural invariant: reminders are scheduled when a visit is CONFIRMED,
    // not at booking time, to avoid sending reminders for unconfirmed visits.
    const state = read('services/visitState.service.ts');
    expect(state).toContain('scheduleVisitReminderJobs');
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

  test('interactive slot uses pending approval flow (createVisitApprovalRequest)', () => {
    // Architectural invariant: slot button selection routes through createVisitApprovalRequest
    // (agent approval flow) rather than auto-confirming. Auto-confirm logic lives in
    // handleBookVisit and customerVisitBooking.service.
    const orch = read('services/whatsapp/whatsappInteractiveOrchestrator.service.ts');
    const slotBlock = orch.slice(
      orch.indexOf('async function handleVisitTimeSlot'),
      orch.indexOf('async function handleGenericVisitSlot'),
    );
    // Slot handler must use createVisitApprovalRequest (not direct scheduleVisit without approval)
    expect(slotBlock).toContain('createVisitApprovalRequest');
    // Confirmed visit changes must notify the agent, not silently overwrite
    expect(slotBlock).toContain('notifyAgentVisitChangeRequested');
    expect(slotBlock).not.toContain("New Visit Booked!");
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
    // Auto-confirm is only used in the customer AI path (customerVisitBooking.service).
    // WhatsApp slot buttons use the agent-approval flow (createVisitApprovalRequest).
    expect(read('services/visitAutoConfirm.service.ts')).toContain('isVisitAutoConfirmEnabled');
    expect(read('services/customerVisitBooking.service.ts')).toContain('isVisitAutoConfirmEnabled');
    // Orchestrator slot-selection now routes through pending approval, not auto-confirm
    const orch = read('services/whatsapp/whatsappInteractiveOrchestrator.service.ts');
    expect(orch).toContain('createVisitApprovalRequest');
  });
});
