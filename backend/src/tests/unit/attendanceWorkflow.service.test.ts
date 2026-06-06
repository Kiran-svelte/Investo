import {
  ATTENDANCE_BUTTON_IDS,
  buildAttendanceCheckBody,
  resolveAttendanceButtonCommand,
} from '../../services/attendanceWorkflow.service';

describe('attendanceWorkflow.service', () => {
  test('buildAttendanceCheckBody includes visit details', () => {
    const body = buildAttendanceCheckBody({
      id: 'visit-1',
      companyId: 'co-1',
      scheduledAt: new Date('2026-06-06T10:00:00Z'),
      customerName: 'Rahul',
      propertyName: 'Lake Vista',
    });
    expect(body).toContain('Attendance Check Required');
    expect(body).toContain('Rahul');
    expect(body).toContain('Lake Vista');
    expect(body).toContain('Did the customer attend?');
  });

  test('resolveAttendanceButtonCommand maps interactive ids', () => {
    expect(resolveAttendanceButtonCommand(ATTENDANCE_BUTTON_IDS.yes)).toBe('yes');
    expect(resolveAttendanceButtonCommand(ATTENDANCE_BUTTON_IDS.no)).toBe('no');
    expect(resolveAttendanceButtonCommand(ATTENDANCE_BUTTON_IDS.reschedule)).toBe('reschedule');
    expect(resolveAttendanceButtonCommand('copilot-visits-today')).toBeNull();
  });
});
