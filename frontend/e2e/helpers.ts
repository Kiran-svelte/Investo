import { expect, Page, test } from '@playwright/test';

export async function loginIfConfigured(page: Page): Promise<void> {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated flows');

  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');

  const emailInput = page.getByLabel(/email/i);
  const passwordInput = page.getByLabel(/password/i);
  await emailInput.waitFor({ state: 'visible', timeout: 15_000 });

  if (await emailInput.isEnabled()) {
    await emailInput.fill(email!);
    await passwordInput.fill(password!);
  }

  const loginButton = page.locator('button[type="submit"]');
  await loginButton.click();

  try {
    await page.waitForURL((url) => !/\/login$/i.test(url.pathname), { timeout: 30_000 });
  } catch {
    await page.waitForTimeout(1200);
    if (await emailInput.isEnabled()) {
      await emailInput.fill(email!);
      await passwordInput.fill(password!);
    }
    if (await loginButton.isVisible()) {
      await loginButton.click();
    }
    await page.waitForURL((url) => !/\/login$/i.test(url.pathname), { timeout: 30_000 });
  }

  await expect(page).not.toHaveURL(/\/login$/);

  await page.waitForLoadState('networkidle');
}
