/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmiCalculatorPage from './EmiCalculatorPage';

const { postMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  default: {
    post: postMock,
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EmiCalculatorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postMock.mockResolvedValue({
      data: {
        data: {
          principal: 5000000,
          down_payment: 1000000,
          loan_amount: 4000000,
          interest_rate: 8.5,
          tenure_months: 240,
          monthly_emi: 34643,
          total_interest: 4314320,
          total_payment: 9314320,
        },
      },
    });
  });

  it('calculates EMI and exposes share actions', async () => {
    const user = userEvent.setup();

    render(<EmiCalculatorPage />);

    await user.click(screen.getByRole('button', { name: 'Calculate' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/calculate-emi', {
        principal: 5000000,
        down_payment: 1000000,
        interest_rate: 8.5,
        tenure_months: 240,
      });
    });

    expect(await screen.findByText('Monthly EMI')).toBeInTheDocument();
    expect(screen.getByText('₹34,643')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    await user.click(screen.getByRole('button', { name: 'Download text' }));
  });
});