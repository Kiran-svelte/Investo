import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
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

function makePdfTargetSizeBytes(targetBytes) {
  const overhead = buildPdfWithStream(Buffer.alloc(0)).length;
  let streamLen = Math.max(0, targetBytes - overhead);

  let pdf = null;
  for (let i = 0; i < 3; i++) {
    pdf = buildPdfWithStream(Buffer.alloc(streamLen, 0x20));
    const diff = targetBytes - pdf.length;
    if (diff === 0) break;
    streamLen = Math.max(0, streamLen + diff);
  }

  return pdf;
}

async function main() {
  const baseURL = process.env.E2E_BASE_URL;
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  const evidenceDir =
    process.env.EVIDENCE_DIR || path.join(process.cwd(), '..', 'test-results', `prod-frontend-flows-${Date.now()}`);

  const result = {
    timestamp: new Date().toISOString(),
    baseURL: baseURL || null,
    evidenceDir,
    flows: {
      login: { ok: false, finalUrl: null, shellVisible: false, pageErrors: [], consoleErrors: [], screenshots: [] },
      propertyImportSmallPdf: {
        ok: false,
        draftUrl: null,
        draftId: null,
        uploadStatus: null,
        registerUploadFailedTextVisible: false,
        errorBanner: null,
        screenshots: [],
      },
      propertyImportLargePdf: {
        ok: false,
        draftUrl: null,
        draftId: null,
        uploadStatus: null,
        registerUploadFailedTextVisible: false,
        errorBanner: null,
        screenshots: [],
      },
    },
    runtime: {
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
  const pageErrors = [];
  const networkFailures = [];
  const failingResponses = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ text: sanitizeText(msg.text(), 2000) });
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push({ message: sanitizeText(err?.message || String(err), 4000) });
  });

  page.on('requestfailed', (req) => {
    networkFailures.push({
      url: req.url(),
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
      url,
      status,
      method: resp.request().method(),
      bodyPath,
      bodySnippet: safeBody.length > 800 ? `${safeBody.slice(0, 800)}\n…<truncated>` : safeBody,
    });
  });

  const shot = async (name, flowKey) => {
    const outPath = path.join(evidenceDir, name);
    await page.screenshot({ path: outPath, fullPage: true });
    if (flowKey) result.flows[flowKey].screenshots.push(outPath);
    return outPath;
  };

  const gotoPath = async (pathname, wait = 'networkidle') => {
    const url = new URL(pathname, baseURL).toString();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (wait === 'networkidle') await page.waitForLoadState('networkidle').catch(() => undefined);
    return url;
  };

  async function runLoginFlow() {
    try {
      await gotoPath('/login');
      await shot('03-frontend-login.png', 'login');

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

      result.flows.login.ok = pageErrors.length === 0;
      result.flows.login.finalUrl = page.url();

      await shot('04-frontend-after-login.png', 'login');

      if (!result.flows.login.ok) {
        result.failures.push({
          flow: 'login',
          details: 'Uncaught page errors detected after login.',
        });
      }
    } catch (err) {
      result.failures.push({ flow: 'login', details: err instanceof Error ? err.message : String(err) });
      try {
        await shot('99-frontend-login-failure.png', 'login');
      } catch {
        // ignore
      }
    } finally {
      result.flows.login.pageErrors = pageErrors;
      result.flows.login.consoleErrors = consoleErrors;
    }
  }

  async function uploadPdfFlow(flowKey, pdfBuffer, fileName) {
    try {
      await gotoPath('/properties/import');
      await page.getByRole('heading', { name: /upload media/i }).waitFor({ timeout: 45_000 });
      await shot(`${flowKey === 'propertyImportSmallPdf' ? '05' : '08'}-property-import-before.png`, flowKey);

      await page.getByLabel('Select property media files').setInputFiles({
        name: fileName,
        mimeType: 'application/pdf',
        buffer: pdfBuffer,
      });

      // Draft URL tends to appear quickly if register-upload succeeds.
      await page
        .waitForURL(/\/properties\/import\/[a-f0-9-]+/i, { timeout: 60_000 })
        .catch(() => undefined);

      // Observe common UI error for register-upload.
      const failedRegisterVisible = await page
        .getByText(/failed to register upload/i)
        .first()
        .isVisible()
        .catch(() => false);

      result.flows[flowKey].registerUploadFailedTextVisible = failedRegisterVisible;

      // Upload queue: wait for done/failed.
      const uploadSection = page.locator('section').filter({ hasText: /upload media/i }).first();
      await uploadSection.getByText('Upload queue').waitFor({ timeout: 120_000 });

      const fileRow = uploadSection.locator('div').filter({ hasText: fileName }).first();
      await Promise.race([
        fileRow.getByText('done', { exact: true }).waitFor({ timeout: 300_000 }),
        fileRow.getByText('failed', { exact: true }).waitFor({ timeout: 300_000 }),
      ]);

      const rowText = (await fileRow.textContent().catch(() => '')) || '';
      const status = rowText.includes('failed') ? 'failed' : rowText.includes('done') ? 'done' : 'unknown';
      result.flows[flowKey].uploadStatus = status;

      const currentUrl = page.url();
      result.flows[flowKey].draftUrl = currentUrl;
      const parts = new URL(currentUrl).pathname.split('/').filter(Boolean);
      const maybeDraftId = parts[parts.length - 1];
      result.flows[flowKey].draftId = maybeDraftId && maybeDraftId !== 'import' ? maybeDraftId : null;

      const errorBannerText = await page.evaluate(() => {
        const banner = document.querySelector('div.border-red-200');
        return banner?.textContent?.trim() || null;
      });
      result.flows[flowKey].errorBanner = errorBannerText ? sanitizeText(errorBannerText, 2000) : null;

      await shot(`${flowKey === 'propertyImportSmallPdf' ? '06' : '09'}-property-import-after.png`, flowKey);

      const ok = status === 'done' && !failedRegisterVisible;
      result.flows[flowKey].ok = ok;

      if (!ok) {
        const stage = !/\/properties\/import\/[a-f0-9-]+/i.test(new URL(currentUrl).pathname)
          ? 'register_upload'
          : status === 'failed'
            ? 'upload_or_processing'
            : 'unknown';

        result.failures.push({
          flow: flowKey,
          stage,
          details: `Upload did not complete successfully (status=${status}, failedRegisterText=${failedRegisterVisible})`,
        });
      }
    } catch (err) {
      result.failures.push({ flow: flowKey, details: err instanceof Error ? err.message : String(err) });
      try {
        await shot(`98-${flowKey}-failure.png`, flowKey);
      } catch {
        // ignore
      }
    }
  }

  try {
    await runLoginFlow();

    // Stop early if login didn't reach shell.
    if (!result.flows.login.shellVisible) {
      result.failures.push({ flow: 'abort', details: 'Aborted property-import checks because authenticated shell did not load.' });
    } else {
      const smallPdf = buildPdfWithStream(Buffer.alloc(0));
      const smallName = `small-${Date.now()}.pdf`;
      await uploadPdfFlow('propertyImportSmallPdf', smallPdf, smallName);

      const targetBytes = Math.ceil(13.3 * 1024 * 1024);
      const largePdf = makePdfTargetSizeBytes(targetBytes);
      const largeName = `large-${Date.now()}.pdf`;
      await uploadPdfFlow('propertyImportLargePdf', largePdf, largeName);
    }
  } finally {
    result.runtime.networkFailures = networkFailures;
    result.runtime.failingResponses = failingResponses;

    try {
      fs.writeFileSync(path.join(evidenceDir, 'frontend-flow-report.json'), JSON.stringify(result, null, 2), 'utf8');
    } catch {
      // ignore
    }

    await browser.close();
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
