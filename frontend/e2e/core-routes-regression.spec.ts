import { expect, test } from '@playwright/test';
import { loginIfConfigured } from './helpers';

async function assertNoFatalUi(page: any): Promise<void> {
  await expect(page.getByText(/internal server error/i)).toHaveCount(0);
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
}

test.describe('core routes regression', () => {
  test('critical authenticated routes stay accessible', async ({ page }) => {
    await loginIfConfigured(page);

    const routes = ['/leads', '/properties', '/properties/import'];

    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expect(page).not.toHaveURL(/\/login$/);
      await assertNoFatalUi(page);
    }
  });
});
