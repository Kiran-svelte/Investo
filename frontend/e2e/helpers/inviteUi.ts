import { expect, type Page } from '@playwright/test';

export async function assertNoFatalUi(page: Page): Promise<void> {
  await expect(page.getByText(/internal server error/i)).toHaveCount(0);
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
}

export async function loginThroughUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !/\/login$/i.test(url.pathname), { timeout: 30_000 });
}

export async function openAddTeamMemberModal(page: Page): Promise<void> {
  await page.goto('/dashboard/agents');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /add team member/i }).click();
  await expect(page.getByRole('heading', { name: /add team member/i })).toBeVisible();
}

export async function fillInviteForm(
  page: Page,
  input: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    role?: string;
  },
): Promise<void> {
  await page.getByPlaceholder('Asha Mehta').fill(input.name);
  await page.getByPlaceholder('asha@company.com').fill(input.email);
  await page.getByPlaceholder('Min 8 characters').fill(input.password);

  if (input.phone !== undefined) {
    await page.getByPlaceholder('+919876543210').fill(input.phone);
  }

  if (input.role) {
    await page.locator('.investo-modal-panel select').last().selectOption(input.role);
  }
}

export async function submitInviteForm(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^create$/i }).click();
}

export async function logoutFromShell(page: Page): Promise<void> {
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.getByRole('menuitem', { name: /log out|logout/i }).click();
  await page.waitForURL(/\/($|\?)/, { timeout: 20_000 });

  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem('investo_access_token')))
    .toBeNull();

  await page.goto('/dashboard/agents');
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
}

export function attachConsoleErrorGuard(page: Page): { errors: string[]; detach: () => void } {
  const errors: string[] = [];
  const ignoredPatterns = [
    /Download the React DevTools/i,
    /socket\.io/i,
    /ERR_CONNECTION_REFUSED/i,
  ];

  const shouldIgnore = (message: string) => ignoredPatterns.some((pattern) => pattern.test(message));

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !shouldIgnore(msg.text())) {
      errors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    if (!shouldIgnore(err.message)) {
      errors.push(err.message);
    }
  });

  return {
    errors,
    detach: () => undefined,
  };
}
