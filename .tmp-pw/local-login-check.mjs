import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('D:/Investo/.tmp-pw/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleMessages = [];
  const requests = [];
  const responses = [];

  page.on('console', (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() });
  });
  page.on('request', (request) => {
    requests.push({ url: request.url(), method: request.method() });
  });
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/auth/login') || url.includes('/me') || url.includes('/auth')) {
      responses.push({ url, status: response.status() });
    }
  });

  const loginUrl = 'http://127.0.0.1:4180/login';
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#email', { timeout: 30000 });
  await page.waitForSelector('#password', { timeout: 30000 });
  await page.waitForSelector('button[type="submit"]', { timeout: 30000 });

  const loginFormRendered = await page.evaluate(() => {
    const email = document.querySelector('#email');
    const password = document.querySelector('#password');
    const button = document.querySelector('button[type="submit"]');
    return Boolean(email && password && button);
  });

  await page.fill('#email', 'admin@investo.in');
  await page.fill('#password', 'admin@123');
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45000 });
  } catch {
    await page.waitForTimeout(5000);
  }

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const finalUrl = page.url();
  const finalPathname = new URL(finalUrl).pathname;
  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  const dashboardLoaded = /dashboard/i.test(bodyText) || /\/dashboard\b/.test(finalPathname);
  const loginStillVisible = /login/i.test(finalPathname) || /sign in/i.test(bodyText);

  console.log(JSON.stringify({
    attemptedUrl: loginUrl,
    loginFormRendered,
    finalUrl,
    finalPathname,
    dashboardLoaded,
    loginStillVisible,
    authResponses: responses,
    authRequests: requests.filter((entry) => entry.url.includes('/auth/login')),
    consoleMessages,
  }, null, 2));

  await browser.close();
})().catch((error) => {
  console.error(JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
