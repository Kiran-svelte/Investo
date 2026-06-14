import {
  isInvalidPostgresEnumValueError,
  UPCOMING_VISIT_STATUSES_LEGACY,
  UPCOMING_VISIT_STATUSES_WITH_PENDING,
} from '../../utils/prismaEnum.util';

describe('prismaEnum.util', () => {
  it('detects invalid enum literal errors', () => {
    const err = new Error('invalid input value for enum "VisitStatus": "pending_approval"');
    expect(isInvalidPostgresEnumValueError(err, 'pending_approval')).toBe(true);
    expect(isInvalidPostgresEnumValueError(err, 'scheduled')).toBe(false);
    expect(isInvalidPostgresEnumValueError(new Error('other'), 'pending_approval')).toBe(false);
  });

  it('exports upcoming visit status lists', () => {
    expect(UPCOMING_VISIT_STATUSES_WITH_PENDING).toContain('pending_approval');
    expect(UPCOMING_VISIT_STATUSES_LEGACY).not.toContain('pending_approval');
  });
});
