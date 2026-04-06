const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const targets = await waitForJson('http://127.0.0.1:9222/json/list');
  const target = targets.find((entry) => entry.type === 'page' && entry.url.includes('127.0.0.1:5182')) || targets.find((entry) => entry.type === 'page');
  if (!target) throw new Error('No page target found');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const consoleMessages = [];
  const networkFailures = [];
  const networkResponses = [];
  const networkRequests = [];
  const pageEvents = [];

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const handlers = pending.get(message.id);
      if (handlers) {
        pending.delete(message.id);
        if (message.error) {
          handlers.reject(new Error(message.error.message || 'CDP command failed'));
        } else {
          handlers.resolve(message.result || {});
        }
      }
      return;
    }

    switch (message.method) {
      case 'Runtime.consoleAPICalled':
        consoleMessages.push({
          type: message.params.type,
          text: message.params.args?.map((arg) => arg.value ?? arg.description ?? '').join(' '),
        });
        break;
      case 'Runtime.exceptionThrown':
        consoleMessages.push({ type: 'exception', text: message.params.exceptionDetails?.text || 'exception' });
        break;
      case 'Network.loadingFailed':
        networkFailures.push({
          requestId: message.params.requestId,
          errorText: message.params.errorText,
          canceled: message.params.canceled,
          blockedReason: message.params.blockedReason,
        });
        break;
      case 'Network.requestWillBeSent':
        networkRequests.push({
          requestId: message.params.requestId,
          url: message.params.request.url,
          method: message.params.request.method,
          type: message.params.type,
        });
        break;
      case 'Network.responseReceived':
        networkResponses.push({
          url: message.params.response.url,
          status: message.params.response.status,
          mimeType: message.params.response.mimeType,
        });
        break;
      case 'Page.frameNavigated':
        pageEvents.push({ type: 'frameNavigated', url: message.params.frame.url });
        break;
      case 'Page.loadEventFired':
        pageEvents.push({ type: 'loadEventFired' });
        break;
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
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

  await send('Page.navigate', { url: 'http://127.0.0.1:5182/login' });

  const evalValue = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    return result?.result?.value;
  };

  const waitFor = async (predicateExpression, timeoutMs = 15000, intervalMs = 200) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const value = await evalValue(predicateExpression);
        if (value) return true;
      } catch {}
      await sleep(intervalMs);
    }
    return false;
  };

  const pageReady = await waitFor('(() => !!document.querySelector("#email") && !!document.querySelector("#password") && !!document.querySelector("button[type=\\"submit\\"]"))()');
  if (!pageReady) throw new Error('Login form did not render');

  await evalValue('(() => { localStorage.clear(); sessionStorage.clear(); return true; })()');

  const setValueScript = (selector, value) => `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor.set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;

  const emailSet = await evalValue(setValueScript('#email', 'admin@investo.in'));
  const passwordSet = await evalValue(setValueScript('#password', 'admin@123'));
  if (!emailSet || !passwordSet) throw new Error('Failed to populate login form');

  await evalValue('(() => { document.querySelector("button[type=\\"submit\\"]")?.click(); return true; })()');

  const redirected = await waitFor('(() => window.location.pathname !== "/login")()', 20000, 250);
  await sleep(1000);

  const final = await evalValue('(() => ({ href: window.location.href, pathname: window.location.pathname, title: document.title, bodyText: document.body.innerText.slice(0, 300) }))()');
  const loginCall = networkResponses.find((entry) => entry.url.includes('/auth/login')) || null;
  const loginRequest = networkRequests.filter((entry) => entry.url.includes('/auth/login'));
  const authFailures = networkFailures.filter((entry) => !entry.canceled);
  const consoleErrors = consoleMessages.filter((entry) => entry.type === 'error' || entry.type === 'exception');
  const bannerVisible = await evalValue('(() => { const text = document.body.innerText || ""; return /login failed|invalid credentials|error/i.test(text); })()');

  console.log(JSON.stringify({
    url: 'http://127.0.0.1:5182/login',
    redirected,
    final,
    loginCall,
    loginRequest,
    consoleMessages,
    networkFailures: authFailures,
    pageEvents,
    consoleErrors,
    bannerVisible,
  }, null, 2));

  ws.close();
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
