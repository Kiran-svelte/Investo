import { expect, test } from '@playwright/test';
import { loginIfConfigured } from './helpers';

/**
 * Verifies publish pre-flight: /api/health flat JSON + UI embeddings banner on import wizard.
 */
test.describe('property import publish health', () => {
  test('health API reports OpenAI embeddings ready (production)', async ({ page }) => {
    test.setTimeout(90_000);
    await loginIfConfigured(page);

    const health = await page.evaluate(async () => {
      const res = await fetch('https://investo-backend-v2.onrender.com/api/health');
      return res.json();
    });

    const emb = health?.dependencies?.property_knowledge_embeddings;
    expect(emb?.status).toBe('ok');
    expect(emb?.provider).toBe('openai');
  });

  test('import wizard shows embeddings ready on publish step when draft is complete', async ({ page }) => {
    test.setTimeout(120_000);
    await loginIfConfigured(page);

    const draftId = process.env.E2E_PROPERTY_IMPORT_DRAFT_ID;
    test.skip(!draftId, 'Set E2E_PROPERTY_IMPORT_DRAFT_ID to a draft at publish step');

    await page.goto(`/dashboard/properties/import/${draftId}`);
    await expect(page.getByRole('heading', { name: /add a property/i })).toBeVisible({ timeout: 30_000 });

    const step5 = page.getByRole('heading', { name: /step 5/i });
    if (await step5.isVisible().catch(() => false)) {
      await expect(page.getByText(/checking openai indexing/i)).toHaveCount(0, { timeout: 45_000 });
      await expect(
        page.getByText(/openai embeddings ready|embeddings ready for publish/i),
      ).toBeVisible({ timeout: 45_000 });
      await expect(page.getByRole('button', { name: /ready to go/i })).toBeEnabled({ timeout: 15_000 });
    }
  });
});
