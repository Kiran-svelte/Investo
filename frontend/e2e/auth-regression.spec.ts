import { expect, test } from '@playwright/test';
import { loginIfConfigured } from './helpers';

test.describe('auth regression', () => {
  test('login flow reaches authenticated shell', async ({ page }) => {
    await loginIfConfigured(page);

    await expect(page).toHaveURL(/\/$|\/dashboard|\/leads|\/properties|\/onboarding/);

    const accessToken = await page.evaluate(() => localStorage.getItem('investo_access_token'));
    expect(accessToken).toBeTruthy();
  });
});
