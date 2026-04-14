import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

function maskText(text, max = 220) {
  if (!text) return text;
  const trimmed = String(text).replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function isTruthyString(value) {
  return Boolean(value && String(value).trim().length);
}

async function readStat(page, label) {
  return await page.evaluate((needle) => {
    const ps = Array.from(document.querySelectorAll('p'));
    const labelEl = ps.find((p) => (p.textContent || '').trim() === needle);
    if (!labelEl) return null;
    const parent = labelEl.parentElement;
    if (!parent) return null;
    const all = Array.from(parent.querySelectorAll('p'));
    if (all.length < 2) return null;
    return (all[1].textContent || '').trim() || null;
  }, label);
}

async function main() {
  const baseURL = process.env.E2E_BASE_URL;
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  const brochurePath = process.env.BROCHURE_PATH;

  const evidenceDir = process.env.EVIDENCE_DIR || path.join(process.cwd(), '..', 'test-results', `user-flow-proof-${Date.now()}`);

  const result = {
    timestamp: new Date().toISOString(),
    baseURL,
    evidenceDir,
    login: { ok: false, finalUrl: null },
    whatsapp: {
      pageLoaded: false,
      badge: null,
      phoneNumberIdPresent: false,
      accessTokenPresent: false,
      verifyTokenPresent: false,
      accessTokenLength: 0,
      testAttempted: false,
      testOutcome: 'skipped',
      message: null,
    },
    propertyImport: {
      pageLoaded: false,
      brochure: {
        path: brochurePath,
        fileName: brochurePath ? path.basename(brochurePath) : null,
        sizeBytes: null,
      },
      draftId: null,
      upload: {
        attempted: false,
        ok: false,
        status: null,
        errorBanner: null,
      },
      extraction: {
        draftStatus: null,
        extractionStatus: null,
      },
    },
    runtime: {
      consoleErrors: 0,
      networkFailures: 0,
    },
    failures: [],
  };

  if (!baseURL || !email || !password || !brochurePath) {
    console.log(
      JSON.stringify(
        {
          error: 'Missing required env vars',
          baseURL,
          hasEmail: !!email,
          hasPassword: !!password,
          hasBrochurePath: !!brochurePath,
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  if (!fs.existsSync(brochurePath)) {
    console.log(JSON.stringify({ error: 'Brochure file not found', brochurePath }, null, 2));
    process.exit(2);
  }

  result.propertyImport.brochure.sizeBytes = fs.statSync(brochurePath).size;
  fs.mkdirSync(evidenceDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(60_000);

  const consoleErrors = [];
  const networkFailures = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ text: msg.text() });
    }
  });

  page.on('requestfailed', (req) => {
    networkFailures.push({ url: req.url(), errorText: req.failure()?.errorText || null });
  });

  const shot = async (name) => {
    await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true });
  };

  const goto = async (pathname, screenshotName) => {
    const url = new URL(pathname, baseURL).toString();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    if (screenshotName) await shot(screenshotName);
  };

  try {
    console.log('[1/3] Login');
    await goto('/login', '01-login.png');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /log in|login|sign in/i }).click();

    await page.waitForFunction(() => !window.location.pathname.includes('/login'));
    await page.waitForLoadState('networkidle').catch(() => undefined);

    result.login.ok = true;
    result.login.finalUrl = page.url();
    await shot('02-after-login.png');
  } catch (err) {
    result.failures.push({ step: 'login', details: err instanceof Error ? err.message : String(err) });
    try {
      await shot('99-login-failure.png');
    } catch {
      // ignore
    }
  }

  if (result.login.ok) {
    try {
      console.log('[2/3] WhatsApp settings');
      await goto('/ai-settings', '03-ai-settings.png');
      result.whatsapp.pageLoaded = true;

      const connectedVisible = await page
        .getByText(/^Connected$/)
        .first()
        .isVisible()
        .catch(() => false);
      const notConfiguredVisible = await page
        .getByText(/^Not Configured$/)
        .first()
        .isVisible()
        .catch(() => false);
      result.whatsapp.badge = connectedVisible ? 'Connected' : notConfiguredVisible ? 'Not Configured' : null;

      // Inputs are not associated with <label htmlFor>, so use DOM proximity selectors.
      const phoneNumberIdInput = page.locator('label', { hasText: /phone number id/i }).locator('..').locator('input').first();
      const accessTokenInput = page.locator('label', { hasText: /access token/i }).locator('..').locator('input').first();
      const verifyTokenInput = page.locator('label', { hasText: /verify token/i }).locator('..').locator('input').first();

      await phoneNumberIdInput.waitFor({ state: 'attached', timeout: 30_000 });
      await accessTokenInput.waitFor({ state: 'attached', timeout: 30_000 });
      await verifyTokenInput.waitFor({ state: 'attached', timeout: 30_000 });

      const phoneNumberId = await phoneNumberIdInput.inputValue().catch(() => '');
      const accessToken = await accessTokenInput.inputValue().catch(() => '');
      const verifyToken = await verifyTokenInput.inputValue().catch(() => '');

      result.whatsapp.phoneNumberIdPresent = isTruthyString(phoneNumberId);
      result.whatsapp.accessTokenPresent = isTruthyString(accessToken);
      result.whatsapp.verifyTokenPresent = isTruthyString(verifyToken);
      result.whatsapp.accessTokenLength = accessToken ? accessToken.length : 0;

      // Safe defaults (never print token values)
      const desiredPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || phoneNumberId || '109052801080770';
      const desiredVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN || verifyToken || 'investo_webhook_verify_token';
      const desiredAccessToken = process.env.WHATSAPP_ACCESS_TOKEN || accessToken || '';

      let changed = false;
      if (desiredPhoneNumberId && desiredPhoneNumberId !== phoneNumberId) {
        await phoneNumberIdInput.fill(desiredPhoneNumberId);
        changed = true;
      }
      if (desiredVerifyToken && desiredVerifyToken !== verifyToken) {
        await verifyTokenInput.fill(desiredVerifyToken);
        changed = true;
      }
      if (desiredAccessToken && desiredAccessToken !== accessToken) {
        await accessTokenInput.fill(desiredAccessToken);
        changed = true;
      }

      if (changed) {
        await page.getByRole('button', { name: /save whatsapp configuration/i }).click();
        await page.waitForTimeout(1200);
        await shot('04-ai-settings-after-save.png');
      }

      if (desiredPhoneNumberId && desiredAccessToken) {
        result.whatsapp.testAttempted = true;
        await page.getByRole('button', { name: /test connection|test_connection/i }).click();

        const outcomeLocator = page
          .getByText(/ai_settings\.whatsapp_test_success|WhatsApp connection test successful|✅|❌/)
          .first();

        await outcomeLocator.waitFor({ timeout: 30_000 }).catch(() => undefined);
        const msg = await outcomeLocator.textContent().catch(() => null);

        result.whatsapp.message = maskText(msg);
        result.whatsapp.testOutcome = msg && (msg.includes('✅') || msg.toLowerCase().includes('success')) ? 'success' : 'fail';
        await shot('05-whatsapp-test.png');
      } else {
        result.whatsapp.testOutcome = 'skipped';
        result.whatsapp.message = !desiredAccessToken ? 'Skipped: missing access token' : 'Skipped: missing phoneNumberId';
      }

      if (!result.whatsapp.accessTokenPresent && !process.env.WHATSAPP_ACCESS_TOKEN) {
        result.failures.push({
          step: 'whatsapp.config',
          details: 'WhatsApp access token is not present in UI settings (and WHATSAPP_ACCESS_TOKEN is not set); cannot prove outbound connectivity.',
        });
      }
    } catch (err) {
      result.failures.push({ step: 'whatsapp', details: err instanceof Error ? err.message : String(err) });
      try {
        await shot('98-whatsapp-failure.png');
      } catch {
        // ignore
      }
    }

    try {
      console.log('[3/3] Property import (upload brochure PDF)');
      await goto('/properties/import', '06-property-import.png');
      result.propertyImport.pageLoaded = true;

      const fileName = path.basename(brochurePath);
      result.propertyImport.upload.attempted = true;

      await page.getByLabel('Select property media files').setInputFiles(brochurePath);

      const uploadSection = page.locator('section').filter({ hasText: 'Upload media' }).first();
      await uploadSection.getByText('Upload queue').waitFor({ timeout: 120_000 });

      const fileRow = uploadSection.locator('div').filter({ hasText: fileName }).first();
      await Promise.race([
        fileRow.getByText('done', { exact: true }).waitFor({ timeout: 300_000 }),
        fileRow.getByText('failed', { exact: true }).waitFor({ timeout: 300_000 }),
      ]);

      const rowText = await fileRow.textContent().catch(() => '');
      const status = rowText.includes('failed') ? 'failed' : rowText.includes('done') ? 'done' : 'unknown';
      result.propertyImport.upload.status = status;
      result.propertyImport.upload.ok = status === 'done';

      const url = new URL(page.url());
      const parts = url.pathname.split('/').filter(Boolean);
      const maybeDraftId = parts[parts.length - 1];
      result.propertyImport.draftId = maybeDraftId && maybeDraftId !== 'import' ? maybeDraftId : null;

      const errorBannerText = await page.evaluate(() => {
        const banner = document.querySelector('div.border-red-200');
        return banner?.textContent?.trim() || null;
      });
      result.propertyImport.upload.errorBanner = maskText(errorBannerText);

      const refreshBtn = page.getByRole('button', { name: /refresh status/i });
      const started = Date.now();

      while (Date.now() - started < 180_000) {
        const draftStatus = await readStat(page, 'Draft status');
        const extractionStatus = await readStat(page, 'Extraction');

        if (draftStatus) result.propertyImport.extraction.draftStatus = draftStatus;
        if (extractionStatus) result.propertyImport.extraction.extractionStatus = extractionStatus;

        if (String(extractionStatus || '').toLowerCase() === 'extracted') {
          break;
        }

        await refreshBtn.click().catch(() => undefined);
        await page.waitForTimeout(5000);
      }

      await shot('07-property-import-after-upload.png');

      if (!result.propertyImport.upload.ok) {
        result.failures.push({ step: 'propertyImport.upload', details: `Upload did not complete successfully (status=${status})` });
      }
    } catch (err) {
      result.failures.push({ step: 'propertyImport', details: err instanceof Error ? err.message : String(err) });
      try {
        await shot('97-property-import-failure.png');
      } catch {
        // ignore
      }
    }
  }

  try {
    if (!result.login.ok) {
      result.failures.push({ step: 'abort', details: 'Aborted remaining steps because login failed.' });
    }
  } finally {
    result.runtime.consoleErrors = consoleErrors.length;
    result.runtime.networkFailures = networkFailures.length;
    await browser.close();
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
