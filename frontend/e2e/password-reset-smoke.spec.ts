import { expect, test } from '@playwright/test';

test.describe('password reset smoke', () => {
  test('forgot-password shows generic success message', async ({ page }) => {
    const email = process.env.E2E_FORGOT_PASSWORD_EMAIL;

    test.skip(!email, 'Set E2E_FORGOT_PASSWORD_EMAIL to run password reset smoke');

    await page.goto('/forgot-password');
    await page.getByLabel(/email/i).fill(email!);
    await page.getByRole('button', { name: /send reset link/i }).click();

    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();
    await expect(page.getByText(/if an account exists with this email/i)).toBeVisible();
  });
});
