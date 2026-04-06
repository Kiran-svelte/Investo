const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://investo-frontend-v2.onrender.com/login', {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });

  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input')).map((i) => ({
      id: i.id || null,
      name: i.getAttribute('name'),
      type: i.getAttribute('type'),
      placeholder: i.getAttribute('placeholder'),
      autocomplete: i.getAttribute('autocomplete'),
      visible: !!(i.offsetWidth || i.offsetHeight || i.getClientRects().length),
    }));

    const buttons = Array.from(document.querySelectorAll('button')).map((b) => ({
      text: (b.textContent || '').trim(),
      type: b.getAttribute('type'),
      visible: !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length),
    }));

    return {
      href: window.location.href,
      title: document.title,
      hasForm: !!document.querySelector('form'),
      bodySnippet: (document.body?.innerText || '').slice(0, 500),
      inputs,
      buttons,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
