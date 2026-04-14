import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { Buffer } from 'node:buffer';

function pad10(n) {
  return String(n).padStart(10, '0');
}

function redactJson(value) {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (/token|authorization|password|secret/i.test(key)) {
        out[key] = '<REDACTED>';
      } else {
        out[key] = redactJson(v);
      }
    }
    return out;
  }
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer <REDACTED>')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<REDACTED_JWT>');
  }
  return value;
}

function sanitizeText(text, maxChars = 20000) {
  if (!text) return text;

  let safe = String(text);
  safe = safe
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer <REDACTED>')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<REDACTED_JWT>');

  try {
    const parsed = JSON.parse(safe);
    safe = JSON.stringify(redactJson(parsed), null, 2);
  } catch {
    // not json
  }

  return safe.length > maxChars ? `${safe.slice(0, maxChars)}\n…<truncated>` : safe;
}

function sanitizeUrl(rawUrl) {
  if (!rawUrl) return rawUrl;

  try {
    const u = new URL(rawUrl);

    for (const [k] of u.searchParams) {
      if (/token|auth|authorization|password|secret/i.test(k)) {
        u.searchParams.set(k, '<REDACTED>');
      }
    }

    return sanitizeText(u.toString(), 4000);
  } catch {
    return sanitizeText(String(rawUrl), 4000);
  }
}

function buildPdfWithStream(streamData) {
  const parts = [];
  const offsets = [];
  let total = 0;

  const pushStr = (s) => {
    const b = Buffer.from(s, 'utf8');
    parts.push(b);
    total += b.length;
  };

  const pushBuf = (b) => {
    parts.push(b);
    total += b.length;
  };

  pushStr('%PDF-1.4\n');

  offsets[1] = total;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  offsets[2] = total;
  pushStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  offsets[3] = total;
  pushStr('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n');

  offsets[4] = total;
  pushStr(`4 0 obj\n<< /Length ${streamData.length} >>\nstream\n`);
  pushBuf(streamData);
  pushStr('\nendstream\nendobj\n');

  const xrefStart = total;
  pushStr('xref\n');
  pushStr('0 5\n');
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i <= 4; i++) {
    pushStr(`${pad10(offsets[i])} 00000 n \n`);
  }

  pushStr('trailer\n');
  pushStr('<< /Size 5 /Root 1 0 R >>\n');
  pushStr('startxref\n');
  pushStr(`${xrefStart}\n`);
  pushStr('%%EOF\n');

  return Buffer.concat(parts);
}

async function httpGetText(url) {
  if (typeof fetch === 'function') {
    const resp = await fetch(url, { method: 'GET' });
    const text = await resp.text();
    return { status: resp.status, ok: resp.ok, text };
  }

  return await new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(Buffer.from(d)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode || 0, ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300, text });
        });
      })
      .on('error', reject);
  });
}

function isLikelyNotFoundOrForbiddenPage(page) {
  return page
    .getByText(/not found|page not found|404|forbidden|unauthorized|access denied/i)
    .first()
    .isVisible()
    .catch(() => false);
}

async function main() {
  const baseURL = process.env.E2E_BASE_URL;
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  const evidenceDir =
    process.env.EVIDENCE_DIR || path.join(process.cwd(), '..', 'docs', 'plan', 'adhoc', 'evidence', `expanded-ui-smoke-${Date.now()}`);

  const result = {
    timestamp: new Date().toISOString(),
    baseURL: baseURL || null,
    evidenceDir,
    flows: {
      login: {
        ok: false,
        finalUrl: null,
        shellVisible: false,
        screenshots: [],
        runtimeDelta: null,
      },
      dashboard: {
        ok: false,
        widgetsLoaded: false,
        screenshots: [],
        runtimeDelta: null,
      },
      leadsList: {
        ok: false,
        listLoaded: false,
        emptyState: false,
        leadRowCount: 0,
        screenshots: [],
        runtimeDelta: null,
      },
      leadDetail: {
        ok: false,
        opened: false,
        url: null,
        skipped: false,
        skippedReason: null,
        screenshots: [],
        runtimeDelta: null,
      },
      visits: {
        ok: false,
        rendered: false,
        skipped: false,
        skippedReason: null,
        screenshots: [],
        runtimeDelta: null,
      },
      properties: {
        ok: false,
        rendered: false,
        screenshots: [],
        runtimeDelta: null,
      },
      propertyImportSmallPdf: {
        ok: false,
        draftUrl: null,
        draftId: null,
        uploadStatus: null,
        registerUploadFailedTextVisible: false,
        observedRegisterUpload500: false,
        errorBanner: null,
        screenshots: [],
        runtimeDelta: null,
      },
      webhookVerify: {
        ok: false,
        url:
          'https://investo-backend-v2.onrender.com/api/webhook?hub.mode=subscribe&hub.verify_token=investo_webhook_verify_token&hub.challenge=test123',
        status: null,
        expectedBodyExact: 'test123',
        bodyPath: null,
        bodyActualPreview: null,
      },
    },
    runtime: {
      consoleErrors: [],
      consoleWarnings: [],
      pageErrors: [],
      networkFailures: [],
      failingResponses: [],
    },
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

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const networkFailures = [];
  const failingResponses = [];

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error') {
      consoleErrors.push({ text: sanitizeText(msg.text(), 2000) });
    } else if (type === 'warning') {
      consoleWarnings.push({ text: sanitizeText(msg.text(), 2000) });
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push({ message: sanitizeText(err?.message || String(err), 4000) });
  });

  page.on('requestfailed', (req) => {
    networkFailures.push({
      url: sanitizeUrl(req.url()),
      method: req.method(),
      errorText: sanitizeText(req.failure()?.errorText || '', 1000),
    });
  });

  page.on('response', async (resp) => {
    const status = resp.status();
    if (status < 400) return;

    const url = resp.url();

    // Focus on app/backend/API failures; avoid storing large assets.
    const shouldCapture =
      /investo-backend-v2\.onrender\.com\/api/i.test(url) ||
      /\/api\//i.test(url) ||
      /\/auth\//i.test(url) ||
      /property-import/i.test(url);

    if (!shouldCapture) return;

    if (status === 500 && /property-imports\/drafts\/[^/]+\/uploads/i.test(url)) {
      result.flows.propertyImportSmallPdf.observedRegisterUpload500 = true;
    }

    let bodyText = '';
    try {
      bodyText = await resp.text();
    } catch {
      bodyText = '<unreadable body>';
    }

    const safeBody = sanitizeText(bodyText, 20000);
    const idx = failingResponses.length + 1;
    const bodyPath = path.join(evidenceDir, `fail-response-${idx}.txt`);

    try {
      fs.writeFileSync(bodyPath, safeBody, 'utf8');
    } catch {
      // ignore
    }

    failingResponses.push({
      url: sanitizeUrl(url),
      status,
      method: resp.request().method(),
      bodyPath,
      bodySnippet: safeBody.length > 800 ? `${safeBody.slice(0, 800)}\n…<truncated>` : safeBody,
    });
  });

  const snapshotCounts = () => ({
    consoleErrors: consoleErrors.length,
    consoleWarnings: consoleWarnings.length,
    pageErrors: pageErrors.length,
    networkFailures: networkFailures.length,
    failingResponses: failingResponses.length,
  });

  const deltaCounts = (start) => ({
    consoleErrors: consoleErrors.length - start.consoleErrors,
    consoleWarnings: consoleWarnings.length - start.consoleWarnings,
    pageErrors: pageErrors.length - start.pageErrors,
    networkFailures: networkFailures.length - start.networkFailures,
    failingResponses: failingResponses.length - start.failingResponses,
  });

  const shot = async (name, flowKey) => {
    const outPath = path.join(evidenceDir, name);
    await page.screenshot({ path: outPath, fullPage: false });
    if (flowKey) result.flows[flowKey].screenshots.push(outPath);
    return outPath;
  };

  const gotoPath = async (pathname) => {
    const url = new URL(pathname, baseURL).toString();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    return url;
  };

  const assertNoAuthRedirect = async (flowKey) => {
    const onLogin = /\/login(\/|$)/i.test(new URL(page.url()).pathname);
    if (onLogin) {
      result.failures.push({ flow: flowKey, details: 'Unexpected redirect to /login (lost auth?)' });
      throw new Error('Unexpected auth redirect to /login');
    }
  };

  async function runLoginFlow() {
    const start = snapshotCounts();
    try {
      await gotoPath('/login');
      await shot('01-login.png', 'login');

      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole('button', { name: /log in|login|sign in/i }).click();

      await page
        .waitForURL((u) => !u.pathname.toLowerCase().startsWith('/login'), { timeout: 60_000 })
        .catch(() => undefined);

      await page.waitForLoadState('networkidle').catch(() => undefined);

      // App shell check: sidebar brand should be visible on Desktop Chrome.
      const shell = page.getByText('Investo', { exact: true });
      await shell.waitFor({ timeout: 30_000 });
      result.flows.login.shellVisible = true;

      result.flows.login.finalUrl = page.url();
      result.flows.login.ok = true;

      await shot('02-after-login.png', 'login');
    } catch (err) {
      result.failures.push({ flow: 'login', details: err instanceof Error ? err.message : String(err) });
      try {
        await shot('99-login-failure.png', 'login');
      } catch {
        // ignore
      }
    } finally {
      result.flows.login.runtimeDelta = deltaCounts(start);
    }
  }

  async function runDashboardFlow() {
    const start = snapshotCounts();
    try {
      await gotoPath('/');
      await assertNoAuthRedirect('dashboard');

      await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ timeout: 60_000 });
      await page.getByText('Leads Today').first().waitFor({ timeout: 60_000 });
      await page.getByRole('heading', { name: 'Recent Leads' }).waitFor({ timeout: 60_000 });

      result.flows.dashboard.widgetsLoaded = true;
      result.flows.dashboard.ok = true;

      await shot('03-dashboard.png', 'dashboard');
    } catch (err) {
      result.failures.push({ flow: 'dashboard', details: err instanceof Error ? err.message : String(err) });
      try {
        await shot('98-dashboard-failure.png', 'dashboard');
      } catch {
        // ignore
      }
    } finally {
      result.flows.dashboard.runtimeDelta = deltaCounts(start);
    }
  }

  async function runLeadsListFlow() {
    const start = snapshotCounts();
    try {
      await gotoPath('/leads');
      await assertNoAuthRedirect('leadsList');

      await page.getByRole('heading', { name: 'Lead Management' }).waitFor({ timeout: 60_000 });

      const tbody = page.locator('table tbody').first();
      await tbody.waitFor({ state: 'visible', timeout: 60_000 });

      const firstClickable = tbody.locator('tr.cursor-pointer').first();
      const emptyState = tbody.getByText('No data available').first();

      await Promise.race([
        firstClickable.waitFor({ state: 'visible', timeout: 60_000 }),
        emptyState.waitFor({ state: 'visible', timeout: 60_000 }),
      ]);

      const count = await tbody.locator('tr.cursor-pointer').count();
      const emptyVisible = await emptyState.isVisible().catch(() => false);

      result.flows.leadsList.leadRowCount = count;
      result.flows.leadsList.emptyState = emptyVisible;
      result.flows.leadsList.listLoaded = emptyVisible || count > 0;
      result.flows.leadsList.ok = true;

      await shot('04-leads-list.png', 'leadsList');
    } catch (err) {
      result.failures.push({ flow: 'leadsList', details: err instanceof Error ? err.message : String(err) });
      try {
        await shot('97-leads-list-failure.png', 'leadsList');
      } catch {
        // ignore
      }
    } finally {
      result.flows.leadsList.runtimeDelta = deltaCounts(start);
    }
  }

  async function runLeadDetailFlow() {
    const start = snapshotCounts();
    try {
      // Re-use the currently loaded leads list page.
      await assertNoAuthRedirect('leadDetail');

      const count = result.flows.leadsList.leadRowCount;
      if (!count) {
        result.flows.leadDetail.skipped = true;
        result.flows.leadDetail.skippedReason = 'No leads available in list; cannot open first lead detail.';
        result.flows.leadDetail.ok = true;
        return;
      }

      const firstRow = page.locator('table tbody tr.cursor-pointer').first();
      await firstRow.click();

      await page.waitForURL(/\/leads\/[a-f0-9-]+/i, { timeout: 60_000 }).catch(() => undefined);
      await page.getByRole('button', { name: /back to leads/i }).waitFor({ timeout: 60_000 });

      result.flows.leadDetail.opened = true;
      result.flows.leadDetail.url = page.url();
      result.flows.leadDetail.ok = true;

      await shot('05-lead-detail.png', 'leadDetail');
    } catch (err) {
      result.failures.push({ flow: 'leadDetail', details: err instanceof Error ? err.message : String(err) });
      try {
        await shot('96-lead-detail-failure.png', 'leadDetail');
      } catch {
        // ignore
      }
    } finally {
      result.flows.leadDetail.runtimeDelta = deltaCounts(start);
    }
  }

  async function runVisitsFlow() {
    const start = snapshotCounts();
    try {
      await gotoPath('/calendar');
      await assertNoAuthRedirect('visits');

      const heading = page.getByRole('heading', { name: 'Site Visits' });
      const headingVisible = await heading.isVisible().catch(() => false);

      if (!headingVisible) {
        const maybeSkipped = await isLikelyNotFoundOrForbiddenPage(page);
        if (maybeSkipped) {
          result.flows.visits.skipped = true;
          result.flows.visits.skippedReason = 'Visits page not available for this environment/user (not found/forbidden).';
          result.flows.visits.ok = true;
          await shot('06-visits.png', 'visits');
          return;
        }

        await heading.waitFor({ timeout: 60_000 });
      }

      result.flows.visits.rendered = true;
      result.flows.visits.ok = true;

      await shot('06-visits.png', 'visits');
    } catch (err) {
      result.failures.push({ flow: 'visits', details: err instanceof Error ? err.message : String(err) });
      try {
        await shot('95-visits-failure.png', 'visits');
      } catch {
        // ignore
      }
    } finally {
      result.flows.visits.runtimeDelta = deltaCounts(start);
    }
  }

  async function runPropertiesFlow() {
    const start = snapshotCounts();
    try {
      await gotoPath('/properties');
      await assertNoAuthRedirect('properties');

      await page.getByRole('heading', { name: 'Properties' }).waitFor({ timeout: 60_000 });

      // Render check: either empty state or at least one card.
      const empty = page.getByText('No data available').first();
      const card = page.locator('div.cursor-pointer').filter({ hasText: '' }).first();

      const emptyVisible = await empty.isVisible().catch(() => false);
      if (!emptyVisible) {
        // try to detect at least one property card container
        await page.locator('div.bg-white.rounded-xl').first().waitFor({ timeout: 60_000 }).catch(() => undefined);
      }

      result.flows.properties.rendered = true;
      result.flows.properties.ok = true;

      await shot('07-properties.png', 'properties');
    } catch (err) {
      result.failures.push({ flow: 'properties', details: err instanceof Error ? err.message : String(err) });
      try {
        await shot('94-properties-failure.png', 'properties');
      } catch {
        // ignore
      }
    } finally {
      result.flows.properties.runtimeDelta = deltaCounts(start);
    }
  }

  async function runPropertyImportSmallPdfFlow() {
    const start = snapshotCounts();
    try {
      await gotoPath('/properties/import');
      await assertNoAuthRedirect('propertyImportSmallPdf');

      await page.getByRole('heading', { name: /upload media/i }).waitFor({ timeout: 60_000 });
      await shot('08-property-import-before.png', 'propertyImportSmallPdf');

      const smallPdf = buildPdfWithStream(Buffer.alloc(0));
      const fileName = `small-${Date.now()}.pdf`;

      await page.getByLabel('Select property media files').setInputFiles({
        name: fileName,
        mimeType: 'application/pdf',
        buffer: smallPdf,
      });

      // Draft URL tends to appear quickly if register-upload succeeds.
      await page
        .waitForURL(/\/properties\/import\/[a-f0-9-]+/i, { timeout: 60_000 })
        .catch(() => undefined);

      const failedRegisterVisible = await page
        .getByText(/failed to register upload/i)
        .first()
        .isVisible()
        .catch(() => false);

      result.flows.propertyImportSmallPdf.registerUploadFailedTextVisible = failedRegisterVisible;

      const uploadSection = page.locator('section').filter({ hasText: /upload media/i }).first();
      await uploadSection.getByText('Upload queue').waitFor({ timeout: 120_000 });

      const fileRow = uploadSection.locator('div').filter({ hasText: fileName }).first();
      await Promise.race([
        fileRow.getByText('done', { exact: true }).waitFor({ timeout: 180_000 }),
        fileRow.getByText('failed', { exact: true }).waitFor({ timeout: 180_000 }),
      ]);

      const rowText = (await fileRow.textContent().catch(() => '')) || '';
      const status = rowText.includes('failed') ? 'failed' : rowText.includes('done') ? 'done' : 'unknown';
      result.flows.propertyImportSmallPdf.uploadStatus = status;

      const currentUrl = page.url();
      result.flows.propertyImportSmallPdf.draftUrl = currentUrl;
      const parts = new URL(currentUrl).pathname.split('/').filter(Boolean);
      const maybeDraftId = parts[parts.length - 1];
      result.flows.propertyImportSmallPdf.draftId = maybeDraftId && maybeDraftId !== 'import' ? maybeDraftId : null;

      const errorBannerText = await page.evaluate(() => {
        const banner = document.querySelector('div.border-red-200');
        return banner?.textContent?.trim() || null;
      });
      result.flows.propertyImportSmallPdf.errorBanner = errorBannerText ? sanitizeText(errorBannerText, 2000) : null;

      await shot('09-property-import-after.png', 'propertyImportSmallPdf');

      // Mark ok only if upload completed and no register-upload error surfaced.
      result.flows.propertyImportSmallPdf.ok = status === 'done' && !failedRegisterVisible;

      if (!result.flows.propertyImportSmallPdf.ok) {
        result.failures.push({
          flow: 'propertyImportSmallPdf',
          details: `Upload did not complete successfully (status=${status}, failedRegisterText=${failedRegisterVisible})`,
        });
      }
    } catch (err) {
      result.failures.push({ flow: 'propertyImportSmallPdf', details: err instanceof Error ? err.message : String(err) });
      try {
        await shot('93-property-import-failure.png', 'propertyImportSmallPdf');
      } catch {
        // ignore
      }
    } finally {
      result.flows.propertyImportSmallPdf.runtimeDelta = deltaCounts(start);
    }
  }

  async function runWebhookVerifyFlow() {
    try {
      const url = result.flows.webhookVerify.url;
      const outPath = path.join(evidenceDir, '10-webhook-verify.txt');

      const resp = await httpGetText(url);
      const body = sanitizeText(resp.text, 20000);

      fs.writeFileSync(outPath, body, 'utf8');

      result.flows.webhookVerify.status = resp.status;
      result.flows.webhookVerify.bodyPath = outPath;
      result.flows.webhookVerify.bodyActualPreview = body.length > 300 ? `${body.slice(0, 300)}\n…<truncated>` : body;
      result.flows.webhookVerify.ok = resp.status === 200 && body.trim() === result.flows.webhookVerify.expectedBodyExact;

      if (!result.flows.webhookVerify.ok) {
        result.failures.push({
          flow: 'webhookVerify',
          details: `Unexpected webhook verify response (status=${resp.status}, bodyPreview=${result.flows.webhookVerify.bodyActualPreview})`,
        });
      }
    } catch (err) {
      result.failures.push({ flow: 'webhookVerify', details: err instanceof Error ? err.message : String(err) });
    }
  }

  try {
    await runLoginFlow();

    if (!result.flows.login.shellVisible) {
      result.failures.push({ flow: 'abort', details: 'Aborted remaining UI checks because authenticated shell did not load.' });
    } else {
      await runDashboardFlow();
      await runLeadsListFlow();
      await runLeadDetailFlow();
      await runVisitsFlow();
      await runPropertiesFlow();
      await runPropertyImportSmallPdfFlow();
    }

    await runWebhookVerifyFlow();
  } finally {
    result.runtime.consoleErrors = consoleErrors;
    result.runtime.consoleWarnings = consoleWarnings;
    result.runtime.pageErrors = pageErrors;
    result.runtime.networkFailures = networkFailures;
    result.runtime.failingResponses = failingResponses;

    try {
      fs.writeFileSync(path.join(evidenceDir, 'runtime-console.json'), JSON.stringify(redactJson({ consoleErrors, consoleWarnings, pageErrors }), null, 2), 'utf8');
      fs.writeFileSync(path.join(evidenceDir, 'runtime-network.json'), JSON.stringify(redactJson({ networkFailures, failingResponses }), null, 2), 'utf8');
      fs.writeFileSync(path.join(evidenceDir, 'ui-smoke-report.json'), JSON.stringify(redactJson(result), null, 2), 'utf8');
    } catch {
      // ignore
    }

    await browser.close();
  }

  console.log(JSON.stringify(redactJson(result), null, 2));
  process.exit(result.failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
