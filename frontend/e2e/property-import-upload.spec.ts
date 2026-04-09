import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { loginIfConfigured } from './helpers';

test.describe('property import upload', () => {
  test('registers and uploads a brochure PDF (~13MB)', async ({ page }) => {
    test.setTimeout(180_000);

    await loginIfConfigured(page);

    await page.goto('/properties/import');
    await expect(page.getByRole('heading', { name: /upload media/i })).toBeVisible();

    const fileSizeBytes = Math.ceil(13.3 * 1024 * 1024);
    const buffer = Buffer.alloc(fileSizeBytes, 0x20);
    buffer.write('%PDF-1.4\n', 0, 'utf8');

    const fileName = `e2e-brochure-${Date.now()}.pdf`;

    await page.getByLabel('Select property media files').setInputFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer,
    });

    await expect(page).toHaveURL(/\/properties\/import\/[a-f0-9-]+/i, { timeout: 30_000 });

    await expect(page.getByText(/\bfailed to register upload\b/i)).toHaveCount(0);
    await expect(page.getByText(/\b1 files\b/i)).toBeVisible({ timeout: 180_000 });
  });
});
