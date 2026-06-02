import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

function sanitizeText(text, maxChars = 4000) {
  if (!text) return text;
  const s = String(text)
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer <REDACTED>')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<REDACTED_JWT>');
  return s.length > maxChars ? `${s.slice(0, maxChars)}\n…<truncated>` : s;
}

function sanitizeUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  try {
    const u = new URL(rawUrl);
    for (const [k] of u.searchParams) {
      if (/token|auth|authorization|password|secret|bypass/i.test(k)) {
        u.searchParams.set(k, '<REDACTED>');
      }
    }
    return sanitizeText(u.toString(), 2000);
  } catch {
    return sanitizeText(String(rawUrl), 2000);
  }
}

function truthy(value) {
  return Boolean(value && String(value).trim().length);
}

async function main() {
  const baseURL = process.env.E2E_BASE_URL;
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  const bypass = process.env.VERCEL_PROTECTION_BYPASS;

  const evidenceDir =
    process.env.EVIDENCE_DIR || path.join(process.cwd(), '..', 'test-results', `whatsapp-providers-proof-${Date.now()}`);

  const baseHost = (() => {
    try {
      return new URL(baseURL).hostname;
    } catch {
      return null;
    }
  })();

  const result = {
    timestamp: new Date().toISOString(),
    baseURL: baseURL || null,
    evidenceDir,
    bypassHeaderConfigured: Boolean(bypass && String(bypass).trim().length),
    login: { ok: false, finalUrl: null, error: null },
    whatsapp: {
      pageLoaded: false,
      providerSelectPresent: false,
      meta: {
        webhookUrl: null,
        webhookUrlLooksCorrect: false,
        phoneNumberIdPresent: false,
        accessTokenPresent: false,
        verifyTokenPresent: false,
        testAttempted: false,
        testOutcome: 'skipped',
        message: null,
      },
      greenapi: {
        webhookUrl: null,
        webhookUrlLooksCorrect: false,
        idInstancePresent: false,
        apiTokenInstancePresent: false,
        webhookTokenPresent: false,
        testAttempted: false,
        testOutcome: 'skipped',
        message: null,
      },
    },
    runtime: {
      consoleErrors: [],
      pageErrors: [],
      requestFailures: [],
      failingResponses: [],
    },
    screenshots: [],
    failures: [],
  };

  if (!baseURL || !email || !password) {
    console.log(
      JSON.stringify(
        {
          error: 'Missing required env vars',
          hasBaseUrl: !!baseURL,
          hasEmail: !!email,
          hasPassword: !!password,
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  fs.mkdirSync(evidenceDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(60_000);

  if (bypass && baseHost) {
    await page.route('**/*', async (route) => {
      const req = route.request();
      let host = null;
      try {
        host = new URL(req.url()).hostname;
      } catch {
        host = null;
      }

      if (host === baseHost) {
        const headers = { ...req.headers(), 'x-vercel-protection-bypass': String(bypass) };
        await route.continue({ headers });
        return;
      }

      await route.continue();
    });
  }

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      result.runtime.consoleErrors.push({ text: sanitizeText(msg.text(), 2000) });
    }
  });

  page.on('pageerror', (err) => {
    result.runtime.pageErrors.push({ message: sanitizeText(err?.message || String(err), 4000) });
  });

  page.on('requestfailed', (req) => {
    result.runtime.requestFailures.push({
      url: sanitizeUrl(req.url()),
      method: req.method(),
      errorText: sanitizeText(req.failure()?.errorText || '', 1000),
    });
  });

  page.on('response', async (resp) => {
    const status = resp.status();
    if (status >= 400) {
      result.runtime.failingResponses.push({ url: sanitizeUrl(resp.url()), status });
    }
  });

  const shot = async (name) => {
    const full = path.join(evidenceDir, name);
    await page.screenshot({ path: full, fullPage: true });
    result.screenshots.push(name);
  };

  const goto = async (pathname, screenshotName) => {
    const url = new URL(pathname, baseURL).toString();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    if (screenshotName) await shot(screenshotName);
  };

  const selectProvider = async (value) => {
    const providerSelect = page
      .locator('label', { hasText: /provider/i })
      .locator('..')
      .locator('select')
      .first();

    await providerSelect.waitFor({ state: 'attached', timeout: 20_000 });
    await providerSelect.selectOption(value);
  };

  const fieldInputByLabel = (re) =>
    page.locator('label', { hasText: re }).locator('..').locator('input, textarea, select').first();

  const readInput = async (locator) => {
    try {
      return await locator.inputValue();
    } catch {
      return '';
    }
  };

  const waitForWhatsappSection = async () => {
    const heading = page.getByRole('heading', { name: /whatsapp/i }).first();
    await heading.waitFor({ timeout: 30_000 });
    await heading.scrollIntoViewIfNeeded();
    return heading;
  };

  const whatsappSectionRoot = page.locator('h2', { hasText: /whatsapp/i }).locator('..').locator('..');

  const testConnection = async () => {
    const btn = whatsappSectionRoot.getByRole('button', { name: /test connection|test_connection/i }).first();
    await btn.click();

    const msg = whatsappSectionRoot
      .locator('div')
      .filter({ hasText: /whatsapp connection|disabled in production|required|error|failed|success/i })
      .first();

    await msg.waitFor({ timeout: 30_000 }).catch(() => undefined);
    return sanitizeText((await msg.textContent().catch(() => null)) || null, 500);
  };

  try {
    await goto('/login', '01-login.png');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /log in|login|sign in/i }).click();

    await page.waitForFunction(() => !window.location.pathname.includes('/login'));
    await page.waitForLoadState('networkidle').catch(() => undefined);

    result.login.ok = true;
    result.login.finalUrl = sanitizeUrl(page.url());
    await shot('02-after-login.png');
  } catch (err) {
    result.login.error = err instanceof Error ? err.message : String(err);
    result.failures.push({ step: 'login', details: result.login.error });
    try {
      await shot('99-login-failure.png');
    } catch {
      // ignore
    }
  }

  if (result.login.ok) {
    try {
      await goto('/ai-settings', '03-ai-settings.png');
      result.whatsapp.pageLoaded = true;
      await waitForWhatsappSection();

      const providerSelect = page
        .locator('label', { hasText: /provider/i })
        .locator('..')
        .locator('select')
        .first();

      result.whatsapp.providerSelectPresent = await providerSelect
        .isVisible()
        .catch(() => false);

      if (!result.whatsapp.providerSelectPresent) {
        result.failures.push({
          step: 'whatsapp.ui',
          details: 'Provider selector not found. Deployed frontend may not include the dual-provider UI yet.',
        });
        await shot('98-whatsapp-provider-missing.png');

        // Still collect Meta-only evidence from the currently deployed UI.
        const metaPhoneInput = fieldInputByLabel(/phone number id/i);
        const metaAccessInput = fieldInputByLabel(/access token/i);
        const metaVerifyInput = fieldInputByLabel(/verify token/i);
        const webhookUrlInput = fieldInputByLabel(/webhook url/i);

        await metaPhoneInput.waitFor({ state: 'attached', timeout: 20_000 });
        await metaAccessInput.waitFor({ state: 'attached', timeout: 20_000 });
        await metaVerifyInput.waitFor({ state: 'attached', timeout: 20_000 });
        await webhookUrlInput.waitFor({ state: 'attached', timeout: 20_000 });

        const phoneNumberId = await readInput(metaPhoneInput);
        const accessToken = await readInput(metaAccessInput);
        const verifyToken = await readInput(metaVerifyInput);
        const webhookUrlMeta = await readInput(webhookUrlInput);

        result.whatsapp.meta.phoneNumberIdPresent = truthy(phoneNumberId);
        result.whatsapp.meta.accessTokenPresent = truthy(accessToken);
        result.whatsapp.meta.verifyTokenPresent = truthy(verifyToken);
        result.whatsapp.meta.webhookUrl = sanitizeUrl(webhookUrlMeta);
        result.whatsapp.meta.webhookUrlLooksCorrect =
          truthy(webhookUrlMeta) && webhookUrlMeta.includes('/api/webhook') && !webhookUrlMeta.includes('/greenapi/');

        await shot('04-whatsapp-meta.png');

        if (result.whatsapp.meta.phoneNumberIdPresent && result.whatsapp.meta.accessTokenPresent) {
          result.whatsapp.meta.testAttempted = true;
          result.whatsapp.meta.message = await testConnection();
          result.whatsapp.meta.testOutcome =
            result.whatsapp.meta.message && /success|successful/i.test(result.whatsapp.meta.message) ? 'success' : 'fail';
          await shot('05-whatsapp-meta-test.png');
        } else {
          result.whatsapp.meta.testOutcome = 'skipped';
          result.whatsapp.meta.message = 'Skipped: missing Meta credentials in UI state';
          await shot('05-whatsapp-meta-skip.png');
        }
      } else {
        // META
        await selectProvider('meta');
        await page.waitForTimeout(300);
        await shot('04-whatsapp-meta.png');

        const metaPhoneInput = fieldInputByLabel(/phone number id/i);
        const metaAccessInput = fieldInputByLabel(/access token/i);
        const metaVerifyInput = fieldInputByLabel(/verify token/i);
        const webhookUrlInput = fieldInputByLabel(/webhook url/i);

        await metaPhoneInput.waitFor({ state: 'attached', timeout: 20_000 });
        await metaAccessInput.waitFor({ state: 'attached', timeout: 20_000 });
        await metaVerifyInput.waitFor({ state: 'attached', timeout: 20_000 });
        await webhookUrlInput.waitFor({ state: 'attached', timeout: 20_000 });

        const phoneNumberId = await readInput(metaPhoneInput);
        const accessToken = await readInput(metaAccessInput);
        const verifyToken = await readInput(metaVerifyInput);
        const webhookUrlMeta = await readInput(webhookUrlInput);

        result.whatsapp.meta.phoneNumberIdPresent = truthy(phoneNumberId);
        result.whatsapp.meta.accessTokenPresent = truthy(accessToken);
        result.whatsapp.meta.verifyTokenPresent = truthy(verifyToken);
        result.whatsapp.meta.webhookUrl = sanitizeUrl(webhookUrlMeta);
        result.whatsapp.meta.webhookUrlLooksCorrect =
          truthy(webhookUrlMeta) && webhookUrlMeta.includes('/api/webhook') && !webhookUrlMeta.includes('/greenapi/');

        if (result.whatsapp.meta.phoneNumberIdPresent && result.whatsapp.meta.accessTokenPresent) {
          result.whatsapp.meta.testAttempted = true;
          result.whatsapp.meta.message = await testConnection();
          result.whatsapp.meta.testOutcome =
            result.whatsapp.meta.message && /success|successful/i.test(result.whatsapp.meta.message) ? 'success' : 'fail';
          await shot('05-whatsapp-meta-test.png');
        } else {
          result.whatsapp.meta.testOutcome = 'skipped';
          result.whatsapp.meta.message = 'Skipped: missing Meta credentials in UI state';
          await shot('05-whatsapp-meta-skip.png');
        }

        // GREENAPI
        await selectProvider('greenapi');
        await page.waitForTimeout(300);
        await shot('06-whatsapp-greenapi.png');

        const idInstanceInput = fieldInputByLabel(/instance id/i);
        const apiTokenInput = fieldInputByLabel(/api token/i);
        const webhookTokenInput = fieldInputByLabel(/webhook token/i);
        const webhookUrlInputGreen = fieldInputByLabel(/webhook url/i);

        await idInstanceInput.waitFor({ state: 'attached', timeout: 20_000 });
        await apiTokenInput.waitFor({ state: 'attached', timeout: 20_000 });
        await webhookTokenInput.waitFor({ state: 'attached', timeout: 20_000 });
        await webhookUrlInputGreen.waitFor({ state: 'attached', timeout: 20_000 });

        let idInstance = await readInput(idInstanceInput);
        let apiTokenInstance = await readInput(apiTokenInput);
        let webhookToken = await readInput(webhookTokenInput);
        const webhookUrlGreen = await readInput(webhookUrlInputGreen);

        // Optional fill from env (never printed)
        const envId = process.env.WHATSAPP_GREENAPI_ID_INSTANCE;
        const envApiToken = process.env.WHATSAPP_GREENAPI_API_TOKEN_INSTANCE;
        const envWebhookToken = process.env.WHATSAPP_GREENAPI_WEBHOOK_TOKEN;

        if (!truthy(idInstance) && truthy(envId)) {
          await idInstanceInput.fill(String(envId));
          idInstance = await readInput(idInstanceInput);
        }
        if (!truthy(apiTokenInstance) && truthy(envApiToken)) {
          await apiTokenInput.fill(String(envApiToken));
          apiTokenInstance = await readInput(apiTokenInput);
        }
        if (!truthy(webhookToken) && truthy(envWebhookToken)) {
          await webhookTokenInput.fill(String(envWebhookToken));
          webhookToken = await readInput(webhookTokenInput);
        }

        result.whatsapp.greenapi.idInstancePresent = truthy(idInstance);
        result.whatsapp.greenapi.apiTokenInstancePresent = truthy(apiTokenInstance);
        result.whatsapp.greenapi.webhookTokenPresent = truthy(webhookToken);
        result.whatsapp.greenapi.webhookUrl = sanitizeUrl(webhookUrlGreen);
        result.whatsapp.greenapi.webhookUrlLooksCorrect =
          truthy(webhookUrlGreen) && webhookUrlGreen.includes('/api/greenapi/webhook');

        if (result.whatsapp.greenapi.idInstancePresent && result.whatsapp.greenapi.apiTokenInstancePresent) {
          result.whatsapp.greenapi.testAttempted = true;
          result.whatsapp.greenapi.message = await testConnection();
          result.whatsapp.greenapi.testOutcome =
            result.whatsapp.greenapi.message && /success|successful/i.test(result.whatsapp.greenapi.message)
              ? 'success'
              : 'fail';
          await shot('07-whatsapp-greenapi-test.png');
        } else {
          result.whatsapp.greenapi.testOutcome = 'skipped';
          result.whatsapp.greenapi.message = 'Skipped: missing Green-API credentials in UI state (and env not provided)';
          await shot('07-whatsapp-greenapi-skip.png');
        }
      }
    } catch (err) {
      result.failures.push({ step: 'whatsapp', details: err instanceof Error ? err.message : String(err) });
      try {
        await shot('97-whatsapp-failure.png');
      } catch {
        // ignore
      }
    }
  }

  // Persist evidence
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));

  // Write a small human-readable summary too (still sanitized)
  const summary = {
    timestamp: result.timestamp,
    baseURL: result.baseURL,
    loginOk: result.login.ok,
    providerSelectPresent: result.whatsapp.providerSelectPresent,
    meta: {
      webhookUrlLooksCorrect: result.whatsapp.meta.webhookUrlLooksCorrect,
      credsPresent: result.whatsapp.meta.phoneNumberIdPresent && result.whatsapp.meta.accessTokenPresent,
      testOutcome: result.whatsapp.meta.testOutcome,
      message: result.whatsapp.meta.message,
    },
    greenapi: {
      webhookUrlLooksCorrect: result.whatsapp.greenapi.webhookUrlLooksCorrect,
      credsPresent: result.whatsapp.greenapi.idInstancePresent && result.whatsapp.greenapi.apiTokenInstancePresent,
      testOutcome: result.whatsapp.greenapi.testOutcome,
      message: result.whatsapp.greenapi.message,
    },
    screenshots: result.screenshots,
    failures: result.failures,
    runtime: {
      consoleErrors: result.runtime.consoleErrors.length,
      pageErrors: result.runtime.pageErrors.length,
      requestFailures: result.runtime.requestFailures.length,
      failingResponses: result.runtime.failingResponses.length,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  await browser.close();

  const hardFailures = result.failures.length > 0 || !result.login.ok || !result.whatsapp.pageLoaded;
  process.exit(hardFailures ? 1 : 0);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
  process.exit(1);
});
