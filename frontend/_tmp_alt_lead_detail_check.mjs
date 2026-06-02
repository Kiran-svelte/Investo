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

async function main() {
  const baseURL = process.env.E2E_BASE_URL;
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  const bypass = process.env.VERCEL_PROTECTION_BYPASS;

  const evidenceDir =
    process.env.EVIDENCE_DIR || path.join(process.cwd(), 'test-results', `alt-lead-detail-check-${Date.now()}`);

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
    leadDetail: { ok: false, opened: false, url: null, crash: false, crashSignals: [], error: null },
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
    if (msg.type() === 'error') result.runtime.consoleErrors.push({ text: sanitizeText(msg.text(), 2000) });
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
    if (status < 500) return;
    const url = resp.url();
    if (!/\/api\//i.test(url)) return;
    result.runtime.failingResponses.push({ url: sanitizeUrl(url), status });
  });

  const shot = async (name) => {
    const outPath = path.join(evidenceDir, name);
    await page.screenshot({ path: outPath, fullPage: false });
    result.screenshots.push(outPath);
  };

  const gotoPath = async (pathname) => {
    const url = new URL(pathname, baseURL).toString();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    return url;
  };

  const isVercelAuthOrLogin = async () => {
    const currentHost = (() => {
      try {
        return new URL(page.url()).hostname;
      } catch {
        return null;
      }
    })();

    if (currentHost && currentHost !== baseHost && /(^|\.)vercel\.com$/i.test(currentHost)) return true;

    const t = await page.title().catch(() => '');
    if (/authentication required/i.test(t)) return true;
    if (/log in to vercel/i.test(t)) return true;

    const vercelAuthLinkVisible = await page.getByRole('link', { name: /vercel authentication/i }).isVisible().catch(() => false);
    if (vercelAuthLinkVisible) return true;

    const vercelLoginHeadingVisible = await page.getByRole('heading', { name: /log in to vercel/i }).isVisible().catch(() => false);
    return vercelLoginHeadingVisible;
  };

  const setBypassCookieIfConfigured = async () => {
    if (!bypass) return;

    // Use the APIRequestContext associated with this BrowserContext so cookies persist
    // without having to navigate to a URL containing the bypass token.
    const u = new URL('/', baseURL);
    u.searchParams.set('x-vercel-set-bypass-cookie', 'true');

    try {
      await context.request.get(u.toString(), {
        headers: {
          'x-vercel-protection-bypass': String(bypass),
          Accept: 'text/html',
        },
      });
    } catch (err) {
      result.failures.push({
        step: 'bypassCookie',
        details: err instanceof Error ? err.message : String(err),
      });
    }

    // Record only cookie names (never values)
    try {
      const origin = new URL(baseURL).origin;
      const cookies = await context.cookies(origin);
      result.bypassCookieNames = Array.from(new Set(cookies.map((c) => c.name))).sort();
    } catch {
      // ignore
    }
  };

  try {
    await setBypassCookieIfConfigured();
    await gotoPath('/login');
    await shot('01-login.png');

    if (await isVercelAuthOrLogin()) {
      const msg = 'Blocked by Vercel deployment protection (SSO) — bypass header/cookie required.';
      result.login.error = msg;
      result.failures.push({ step: 'precheck', details: msg });
      await shot('99-vercel-auth-block.png');
      throw new Error(msg);
    }

    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /log in|login|sign in/i }).click();

    await page
      .waitForURL((u) => !u.pathname.toLowerCase().startsWith('/login'), { timeout: 60_000 })
      .catch(() => undefined);

    await page.waitForLoadState('networkidle').catch(() => undefined);

    // If still on /login, treat as failure.
    if (/\/login(\/|$)/i.test(new URL(page.url()).pathname)) {
      throw new Error('Login did not navigate away from /login');
    }

    result.login.ok = true;
    result.login.finalUrl = page.url();
    await shot('02-after-login.png');
  } catch (err) {
    if (!result.login.error) result.login.error = err instanceof Error ? err.message : String(err);
    result.failures.push({ step: 'login', details: result.login.error });
  }

  if (result.login.ok) {
    try {
      await gotoPath('/leads');
      await page.getByRole('heading', { name: 'Lead Management' }).waitFor({ timeout: 60_000 });
      await shot('03-leads-list.png');

      const tbody = page.locator('table tbody').first();
      await tbody.waitFor({ state: 'visible', timeout: 60_000 });

      const firstClickable = tbody.locator('tr.cursor-pointer').first();
      const emptyState = tbody.getByText('No data available').first();

      await Promise.race([
        firstClickable.waitFor({ state: 'visible', timeout: 60_000 }),
        emptyState.waitFor({ state: 'visible', timeout: 60_000 }),
      ]);

      const count = await tbody.locator('tr.cursor-pointer').count();

      if (!count) {
        result.leadDetail.ok = true;
        result.leadDetail.opened = false;
        result.leadDetail.error = 'No leads available in list; cannot open first lead detail.';
        await shot('04-no-leads.png');
      } else {
        result.leadDetail.opened = true;
        await firstClickable.click();

        await page.waitForURL(/\/leads\/[a-f0-9-]+/i, { timeout: 60_000 });
        await page.getByRole('button', { name: /back to leads/i }).waitFor({ timeout: 60_000 });

        result.leadDetail.url = page.url();

        const fatalTextVisible = await page
          .getByText(/internal server error|something went wrong/i)
          .first()
          .isVisible()
          .catch(() => false);

        const crashSignals = [];
        if (fatalTextVisible) crashSignals.push('fatal_error_text_visible');
        if (result.runtime.pageErrors.length) crashSignals.push('pageerror');

        result.leadDetail.crashSignals = crashSignals;
        result.leadDetail.crash = crashSignals.length > 0;
        result.leadDetail.ok = !result.leadDetail.crash;

        await shot('05-lead-detail.png');
      }
    } catch (err) {
      result.leadDetail.error = err instanceof Error ? err.message : String(err);
      result.leadDetail.ok = false;
      result.leadDetail.crash = true;
      result.leadDetail.crashSignals = ['navigation_or_render_failure'];
      result.failures.push({ step: 'leadDetail', details: result.leadDetail.error });
      try {
        await shot('98-lead-detail-failure.png');
      } catch {
        // ignore
      }
    }
  }

  try {
    const outPath = path.join(evidenceDir, 'result.json');
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  } catch {
    // ignore
  }

  await browser.close();

  console.log(JSON.stringify(result, null, 2));

  process.exit(result.failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
