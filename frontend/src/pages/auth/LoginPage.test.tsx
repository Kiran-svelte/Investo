/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import LoginPage from './LoginPage';
import { RESOLUTION_IDS } from '../../constants/resolutionIds';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const values: Record<string, string> = {
        'auth.login': 'Sign in to your workspace',
        'auth.email': 'Email',
        'auth.password': 'Password',
        'auth.forgot_password': 'Forgot password?',
        'auth.login_button': 'Sign in',
        'auth.logging_in': 'Signing in',
        'auth.login_error': 'Could not sign in.',
      };
      return values[key] ?? key;
    },
  }),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    login: vi.fn(),
  }),
}));

vi.mock('../../components/common/LanguageSelector', () => ({
  __esModule: true,
  default: () => <div data-testid="language-selector" />,
}));

vi.mock('../../components/brand/InvestoLogo', () => ({
  __esModule: true,
  default: () => <div data-testid="investo-logo" />,
}));

vi.mock('../../components/brand/AuthSignInLoader', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../../components/brand/LoginBrandIntro', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  LayoutGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  LoginBrandMarkSlot: () => <div data-testid="login-brand-slot" />,
  LoginBrandSplash: () => null,
  LoginSuccessLogoFly: () => null,
  useLoginBrandIntro: () => ({ isSplash: false, layoutId: 'brand' }),
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe('LoginPage', () => {
  it('shows a clear session expired notice from the redirect marker', () => {
    render(
      <MemoryRouter initialEntries={['/login?session=expired']}>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Your session expired. Sign in again to continue.')).toBeInTheDocument();
    expect(document.querySelector(
      `[data-resolution-id="${RESOLUTION_IDS.AUTH_BRAND_RESTORE}"]`,
    )).toBeInTheDocument();
  });
});
