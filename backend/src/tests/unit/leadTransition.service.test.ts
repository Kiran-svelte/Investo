const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    lead: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import {
  canTransitionLeadToVisitScheduledStatus,
  transitionLeadStatus,
} from '../../services/leadTransition.service';

describe('leadTransition.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('allows new -> contacted', async () => {
    mockFindUnique.mockResolvedValue({ id: 'l1', status: 'new' });
    mockUpdate.mockResolvedValue({});

    const ok = await transitionLeadStatus('l1', 'contacted');
    expect(ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'contacted' }) }),
    );
  });

  test('skips invalid new -> visit_scheduled', async () => {
    mockFindUnique.mockResolvedValue({ id: 'l1', status: 'new' });

    const ok = await transitionLeadStatus('l1', 'visit_scheduled');
    expect(ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('no-ops when already at target status', async () => {
    mockFindUnique.mockResolvedValue({ id: 'l1', status: 'contacted' });

    const ok = await transitionLeadStatus('l1', 'contacted');
    expect(ok).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('canTransitionLeadToVisitScheduledStatus only allows valid booking statuses', () => {
    expect(canTransitionLeadToVisitScheduledStatus('new')).toBe(true);
    expect(canTransitionLeadToVisitScheduledStatus('contacted')).toBe(true);
    expect(canTransitionLeadToVisitScheduledStatus('visit_scheduled')).toBe(false);
    expect(canTransitionLeadToVisitScheduledStatus('closed_lost')).toBe(false);
    expect(canTransitionLeadToVisitScheduledStatus('unknown')).toBe(false);
  });
});
