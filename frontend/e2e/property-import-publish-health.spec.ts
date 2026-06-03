import { expect, test } from '@playwright/test';
import { loginIfConfigured } from './helpers';

/**
 * Verifies Step 5 publish pre-flight reads /api/health correctly (flat JSON body).
 */
test.describe('property import publish health', () => {
  test('shows OpenAI embeddings ready on publish step', async ({ page }) => {
    test.setTimeout(120_000);
    await loginIfConfigured(page);

    const draftId = process.env.E2E_PROPERTY_IMPORT_DRAFT_ID;
    test.skip(!draftId, 'Set E2E_PROPERTY_IMPORT_DRAFT_ID to a draft at publish step (extracted, knowledge complete)');

    await page.goto(`/properties/import/${draftId}`);

    await expect(page.getByRole('heading', { name: /step 5/i })).toBeVisible({ timeout: 60_000 });

    await expect(page.getByText(/checking openai indexing/i)).toHaveCount(0, { timeout: 45_000 });
    await expect(
      page.getByText(/openai embeddings ready|embeddings ready for publish/i),
    ).toBeVisible({ timeout: 45_000 });

    const readyButton = page.getByRole('button', { name: /ready to go/i });
    await expect(readyButton).toBeEnabled({ timeout: 15_000 });
  });
});
