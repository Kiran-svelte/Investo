const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://investo-frontend-in3m.onrender.com/login', {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });

  await page.fill('#email', 'admin@investo.in');
  await page.fill('#password', 'admin@123');
  await page.click('button[type="submit"]');

  await page.waitForTimeout(5000);

  const finalUrl = page.url();
  const errorBannerText = await page.evaluate(() => {
    const selectors = [
      '[role="alert"]',
      '.alert',
      '.error',
      '.toast',
      '[data-testid*="error"]',
      '[class*="error"]',
      '[class*="alert"]',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }

    const text = document.body?.innerText || '';
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const guessed = lines.find((line) => /invalid|failed|error|incorrect|unauthorized|forbidden|try again/i.test(line));
    return guessed || null;
  });

  const success = !/\/login\/?$/.test(new URL(finalUrl).pathname);

  console.log(
    JSON.stringify(
      {
        loginSucceeded: success,
        finalUrl,
        visibleErrorBannerText: errorBannerText,
      },
      null,
      2
    )
  );

  await browser.close();
})().catch((error) => {
  console.error(JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
