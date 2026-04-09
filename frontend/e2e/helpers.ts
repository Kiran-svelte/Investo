import { expect, Page, test } from '@playwright/test';

export async function loginIfConfigured(page: Page): Promise<void> {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated flows');

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email!);
  await page.getByLabel(/password/i).fill(password!);
  await page.getByRole('button', { name: /log in|login|sign in/i }).click();

  await expect(page).not.toHaveURL(/\/login$/);

  await page.waitForLoadState('networkidle');
}
