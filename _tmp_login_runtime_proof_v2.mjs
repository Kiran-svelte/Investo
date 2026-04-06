const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const loginUrl = 'https://investo-frontend-v2.onrender.com/login';

  const targets = await waitForJson('http://127.0.0.1:9222/json/list');
  const pageTarget =
    targets.find((entry) => entry.type === 'page' && entry.url.includes('investo-frontend-v2.onrender.com')) ||
    targets.find((entry) => entry.type === 'page');

  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error('No debuggable browser page found on port 9222');
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const consoleMessages = [];
  const networkResponses = [];
  const networkFailures = [];

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);

    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || 'CDP command failed'));
        else p.resolve(msg.result || {});
      }
      return;
    }

    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleMessages.push({
        type: msg.params.type,
        text: (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '),
      });
    }

    if (msg.method === 'Runtime.exceptionThrown') {
      consoleMessages.push({
        type: 'exception',
        text: msg.params.exceptionDetails?.text || 'exception',
      });
    }

    if (msg.method === 'Network.responseReceived') {
      networkResponses.push({
        url: msg.params.response.url,
        status: msg.params.response.status,
      });
    }

    if (msg.method === 'Network.loadingFailed') {
      networkFailures.push({
        requestId: msg.params.requestId,
        errorText: msg.params.errorText,
        canceled: msg.params.canceled,
      });
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await Promise.all([
    send('Page.enable'),
    send('Runtime.enable'),
    send('Network.enable'),
    send('Log.enable'),
  ]);

  await send('Page.navigate', { url: loginUrl });

  const evalValue = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    return result?.result?.value;
  };

  const waitFor = async (predicateExpression, timeoutMs = 20000, intervalMs = 250) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const ok = await evalValue(predicateExpression);
        if (ok) return true;
      } catch {}
      await sleep(intervalMs);
    }
    return false;
  };

  const formLoaded = await waitFor(
    '(() => !!document.querySelector("#email") && !!document.querySelector("#password") && !!document.querySelector("button[type=\\"submit\\"]"))()'
  );
  if (!formLoaded) throw new Error('Login form not ready');

  await evalValue('(() => { localStorage.clear(); sessionStorage.clear(); return true; })()');

  const fillScript = (selector, value) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value') ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;

  const emailOk = await evalValue(fillScript('#email', 'admin@investo.in'));
  const passOk = await evalValue(fillScript('#password', 'admin@123'));
  if (!emailOk || !passOk) throw new Error('Could not fill login fields');

  await evalValue('(() => { document.querySelector("button[type=\\"submit\\"]")?.click(); return true; })()');

  await sleep(7000);

  const finalState = await evalValue(`(() => {
    const text = document.body?.innerText || '';
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const errorLine = lines.find((line) => /invalid|failed|error|incorrect|unauthorized|forbidden|try again/i.test(line)) || null;

    const roleSelectors = [
      '[role="alert"]',
      '.alert',
      '.error',
      '.toast',
      '[data-testid*="error"]',
      '[class*="error"]',
      '[class*="alert"]'
    ];
    let bannerText = null;
    for (const sel of roleSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) {
        bannerText = el.textContent.trim();
        break;
      }
    }

    return {
      href: window.location.href,
      pathname: window.location.pathname,
      title: document.title,
      bannerText,
      errorLine,
      bodySnippet: text.slice(0, 400)
    };
  })()`);

  const loginApi = networkResponses.filter((r) => /\/auth\/login/i.test(r.url));
  const visibleErrorText = finalState.bannerText || finalState.errorLine || null;
  const submitSucceeded = finalState.pathname !== '/login' && finalState.pathname !== '/login/';

  console.log(
    JSON.stringify(
      {
        attemptedUrl: loginUrl,
        formLoaded,
        submitSucceeded,
        finalUrl: finalState.href,
        finalPathname: finalState.pathname,
        visibleErrorText,
        loginApi,
        consoleErrorCount: consoleMessages.filter((m) => m.type === 'error' || m.type === 'exception').length,
        networkFailureCount: networkFailures.filter((f) => !f.canceled).length,
      },
      null,
      2
    )
  );

  ws.close();
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
