import { expect, test } from '@playwright/test';

test('debug property import blank screen route', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
  });
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText || 'unknown'}`);
  });

  const email = process.env.E2E_EMAIL || 'admin@investo.in';
  const password = process.env.E2E_PASSWORD || 'admin@123';

  await page.goto('/login');
  await page.waitForTimeout(1200);
  const emailInput = page.getByLabel(/email/i);
  const enabled = await emailInput.isEnabled().catch(() => false);
  if (enabled) {
    await emailInput.fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /log in|login|sign in/i }).click();
    await page.waitForLoadState('networkidle');
  }

  await page.goto('/properties/import/00b18224-3cb8-4687-8b63-d93010bc2ae9');
  await page.waitForTimeout(5000);

  const main = page.locator('main');
  const bodyText = await page.locator('body').innerText();

  console.log('[DEBUG] pageErrors=', JSON.stringify(pageErrors.slice(0, 20)));
  console.log('[DEBUG] consoleErrors=', JSON.stringify(consoleErrors.slice(0, 20)));
  console.log('[DEBUG] failedRequests=', JSON.stringify(failedRequests.slice(0, 30)));
  console.log('[DEBUG] url=', page.url());
  console.log('[DEBUG] bodyLength=', bodyText.length);

  await expect(main).toBeVisible();
});
