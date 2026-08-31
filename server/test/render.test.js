import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPdfWaitOptions,
  attachPageDiagnostics,
  defaultPdfOptions,
  navigate,
  waitForFonts,
} from '../src/browser/render.js';
import { AppError } from '../src/errors/app-error.js';

const createPage = ({ failOnWaitForSelector = false, documentStub = null } = {}) => {
  const calls = [];
  const handlers = {};

  return {
    calls,
    handlers,
    on(event, handler) {
      calls.push({ method: 'on', value: event });
      (handlers[event] ??= []).push(handler);
    },
    emit(event, payload) {
      for (const handler of handlers[event] ?? []) {
        handler(payload);
      }
    },
    async setRequestInterception(value) {
      calls.push({ method: 'setRequestInterception', value });
    },
    async emulateMediaType(type) {
      calls.push({ method: 'emulateMediaType', value: type });
    },
    async waitForSelector(selector, options) {
      calls.push({ method: 'waitForSelector', value: { selector, options } });
      if (failOnWaitForSelector) {
        const error = new Error(`Waiting for selector \`${selector}\` failed`);
        error.name = 'TimeoutError';
        throw error;
      }
    },
    async evaluate(fn, ...args) {
      calls.push({ method: 'evaluate', value: args[0] });

      if (!documentStub) {
        return;
      }

      const previousDocument = globalThis.document;
      globalThis.document = documentStub;
      try {
        return await fn(...args);
      } finally {
        if (previousDocument === undefined) {
          delete globalThis.document;
        } else {
          globalThis.document = previousDocument;
        }
      }
    },
    async setExtraHTTPHeaders(headers) {
      calls.push({ method: 'setExtraHTTPHeaders', value: headers });
    },
    setDefaultNavigationTimeout(timeoutMs) {
      calls.push({ method: 'setDefaultNavigationTimeout', value: timeoutMs });
    },
    async goto(url, options) {
      calls.push({ method: 'goto', value: { url, options } });
    },
    async setContent(html, options) {
      calls.push({ method: 'setContent', value: { html, options } });
    },
  };
};

test('defaultPdfOptions: applies defaults and allows overrides', () => {
  const result = defaultPdfOptions({ printBackground: false, scale: 2 });

  assert.equal(result.printBackground, false);
  assert.equal(result.scale, 2);
  assert.deepEqual(result.margin, {
    top: '0.4in', right: '0.4in', bottom: '0.4in', left: '0.4in',
  });
});

test('defaultPdfOptions: uses defaults when no options provided', () => {
  const result = defaultPdfOptions();

  assert.equal(result.printBackground, true);
  assert.equal(result.margin.top, '0.4in');
});

const createInterceptedRequest = (url) => {
  const state = { continued: false, continuedWith: undefined };

  return {
    state,
    url: () => url,
    headers: () => ({ accept: '*/*' }),
    isInterceptResolutionHandled: () => false,
    async continue(overrides) {
      state.continued = true;
      state.continuedWith = overrides;
    },
  };
};

test('navigate: html mode applies headers to all requests via setExtraHTTPHeaders', async () => {
  const page = createPage();

  await navigate({ page, html: '<html></html>', headers: { authorization: 'Bearer x' }, timeoutMs: 1000 });

  const headersCall = page.calls.find((c) => c.method === 'setExtraHTTPHeaders');
  assert.deepEqual(headersCall?.value, { authorization: 'Bearer x' });
  assert.equal(page.calls.find((c) => c.method === 'setRequestInterception'), undefined);
});

test('navigate: url mode adds caller headers to same-origin requests only', async () => {
  const page = createPage();

  await navigate({
    page,
    url: 'https://app.example.com/report',
    headers: { authorization: 'Bearer x', 'login-token': 't' },
    timeoutMs: 1000,
  });

  assert.equal(page.calls.find((c) => c.method === 'setExtraHTTPHeaders'), undefined);
  const interceptionCall = page.calls.find((c) => c.method === 'setRequestInterception');
  assert.equal(interceptionCall?.value, true);

  const [handler] = page.handlers.request ?? [];
  assert.ok(handler, 'a request handler should be registered');

  const sameOrigin = createInterceptedRequest('https://app.example.com/api/data');
  handler(sameOrigin);
  assert.equal(sameOrigin.state.continued, true);
  assert.deepEqual(sameOrigin.state.continuedWith, {
    headers: { accept: '*/*', authorization: 'Bearer x', 'login-token': 't' },
  });
});

test('navigate: url mode continues cross-origin requests without caller headers', async () => {
  const page = createPage();

  await navigate({
    page,
    url: 'https://app.example.com/report',
    headers: { authorization: 'Bearer x' },
    timeoutMs: 1000,
  });

  const [handler] = page.handlers.request ?? [];
  assert.ok(handler, 'a request handler should be registered');

  const crossOrigin = createInterceptedRequest('https://static.example.net/font.woff');
  handler(crossOrigin);
  assert.equal(crossOrigin.state.continued, true);
  assert.equal(crossOrigin.state.continuedWith, undefined);

  const unparsable = createInterceptedRequest('not-a-url');
  handler(unparsable);
  assert.equal(unparsable.state.continued, true);
  assert.equal(unparsable.state.continuedWith, undefined);
});

test('navigate: setContent honors an explicit waitUntil option', async () => {
  const page = createPage();

  await navigate({ page, html: '<html></html>', timeoutMs: 1000, waitUntil: 'networkidle2' });

  const setContentCall = page.calls.find((c) => c.method === 'setContent');
  assert.equal(setContentCall?.value.options.waitUntil, 'networkidle2');
});

test('navigate: setContent defaults to domcontentloaded when waitUntil is absent', async () => {
  const page = createPage();

  await navigate({ page, html: '<html></html>', timeoutMs: 1000 });

  const setContentCall = page.calls.find((c) => c.method === 'setContent');
  assert.equal(setContentCall?.value.options.waitUntil, 'domcontentloaded');
});

test('navigate: skips setExtraHTTPHeaders when headers are absent or empty', async () => {
  const page1 = createPage();
  await navigate({ page: page1, url: 'http://example.com', timeoutMs: 1000 });
  assert.equal(page1.calls.find((c) => c.method === 'setExtraHTTPHeaders'), undefined);

  const page2 = createPage();
  await navigate({ page: page2, url: 'http://example.com', headers: {}, timeoutMs: 1000 });
  assert.equal(page2.calls.find((c) => c.method === 'setExtraHTTPHeaders'), undefined);
});

test('navigate: uses html via setContent after goto to blank when no url', async () => {
  const page = createPage();

  await navigate({ page, html: '<html><body>x</body></html>', timeoutMs: 1000 });

  const gotoCall = page.calls.find((c) => c.method === 'goto');
  assert.ok(gotoCall?.value.url.startsWith('data:text/html'));

  const setContentCall = page.calls.find((c) => c.method === 'setContent');
  assert.equal(setContentCall?.value.html, '<html><body>x</body></html>');
});

test('applyPdfWaitOptions: applies emulateMediaType when provided', async () => {
  const page = createPage();

  await applyPdfWaitOptions(page, { emulateMediaType: 'screen' });

  const call = page.calls.find((c) => c.method === 'emulateMediaType');
  assert.equal(call?.value, 'screen');
});

test('applyPdfWaitOptions: waits for selector with default timeout', async () => {
  const page = createPage();

  await applyPdfWaitOptions(page, { waitForSelector: '#root' });

  const call = page.calls.find((c) => c.method === 'waitForSelector');
  assert.equal(call?.value.selector, '#root');
  assert.equal(call?.value.options.timeout, 30_000);
  assert.equal(call?.value.options.visible, true);
});

test('applyPdfWaitOptions: respects custom waitForSelectorTimeoutMs', async () => {
  const page = createPage();

  await applyPdfWaitOptions(page, { waitForSelector: '#root', waitForSelectorTimeoutMs: 1500 });

  const call = page.calls.find((c) => c.method === 'waitForSelector');
  assert.equal(call?.value.options.timeout, 1500);
});

test('applyPdfWaitOptions: wraps selector timeout into AppError with status 504', async () => {
  const page = createPage({ failOnWaitForSelector: true });

  await assert.rejects(
    applyPdfWaitOptions(page, { waitForSelector: '#missing', waitForSelectorTimeoutMs: 500 }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 504);
      assert.equal(error.code, 'WAIT_FOR_SELECTOR_TIMEOUT');
      assert.equal(error.details.selector, '#missing');
      assert.equal(error.details.timeoutMs, 500);
      return true;
    },
  );
});

test('applyPdfWaitOptions: calls evaluate with selector for waitIframeLoading', async () => {
  const page = createPage();

  await applyPdfWaitOptions(page, { waitIframeLoading: '#frame' });

  const call = page.calls.find((c) => c.method === 'evaluate');
  assert.equal(call?.value, '#frame');
});

test('applyPdfWaitOptions: sleeps for waitForTimeout milliseconds', async () => {
  const page = createPage();
  const startedAt = Date.now();

  await applyPdfWaitOptions(page, { waitForTimeout: 30 });

  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 25, `expected >= 25ms, got ${elapsed}ms`);
});

test('applyPdfWaitOptions: fitIframeToContent resizes iframe to its scrollHeight', async () => {
  const iframe = {
    contentDocument: {
      readyState: 'complete',
      body: { scrollHeight: 1234 },
    },
    style: {},
  };
  const documentStub = {
    querySelector: (selector) => (selector === '#chart' ? iframe : null),
  };
  const page = createPage({ documentStub });

  await applyPdfWaitOptions(page, { fitIframeToContent: '#chart' });

  const evaluateCall = page.calls.find((call) => call.method === 'evaluate');
  assert.equal(evaluateCall?.value, '#chart');
  assert.equal(iframe.style.height, '1234px');
});

test('applyPdfWaitOptions: fitIframeToContent is silent when the iframe is missing', async () => {
  const documentStub = { querySelector: () => null };
  const page = createPage({ documentStub });

  await applyPdfWaitOptions(page, { fitIframeToContent: '#missing' });

  const evaluateCall = page.calls.find((call) => call.method === 'evaluate');
  assert.equal(evaluateCall?.value, '#missing');
});

test('applyPdfWaitOptions: fitIframeToContent is silent when the iframe is cross-origin', async () => {
  const iframe = { contentDocument: null, style: {} };
  const documentStub = {
    querySelector: () => iframe,
  };
  const page = createPage({ documentStub });

  await applyPdfWaitOptions(page, { fitIframeToContent: '#cross-origin' });

  assert.equal(iframe.style.height, undefined);
});

test('applyPdfWaitOptions: extractIframeContent replaces page with inner document HTML', async () => {
  const iframe = {
    contentDocument: {
      readyState: 'complete',
      documentElement: { outerHTML: '<html><body><h1>inner</h1></body></html>' },
    },
  };
  const documentStub = {
    querySelector: (selector) => (selector === '#frame' ? iframe : null),
  };
  const page = createPage({ documentStub });

  await applyPdfWaitOptions(page, { extractIframeContent: '#frame' });

  const evaluateCall = page.calls.find((call) => call.method === 'evaluate');
  assert.equal(evaluateCall?.value, '#frame');

  const setContentCall = page.calls.find((call) => call.method === 'setContent');
  assert.equal(setContentCall?.value.html, '<html><body><h1>inner</h1></body></html>');
  assert.equal(setContentCall?.value.options?.waitUntil, 'domcontentloaded');
});

test('applyPdfWaitOptions: extractIframeContent is silent when the iframe is missing', async () => {
  const documentStub = { querySelector: () => null };
  const page = createPage({ documentStub });

  await applyPdfWaitOptions(page, { extractIframeContent: '#missing' });

  const setContentCall = page.calls.find((call) => call.method === 'setContent');
  assert.equal(setContentCall, undefined);
});

test('applyPdfWaitOptions: extractIframeContent is silent when the iframe is cross-origin', async () => {
  const iframe = { contentDocument: null };
  const documentStub = { querySelector: () => iframe };
  const page = createPage({ documentStub });

  await applyPdfWaitOptions(page, { extractIframeContent: '#cross-origin' });

  const setContentCall = page.calls.find((call) => call.method === 'setContent');
  assert.equal(setContentCall, undefined);
});

test('applyPdfWaitOptions: waitForTimeout completes before extractIframeContent runs', async () => {
  const iframe = {
    contentDocument: {
      readyState: 'complete',
      documentElement: { outerHTML: '<html></html>' },
    },
  };
  const documentStub = { querySelector: () => iframe };
  const page = createPage({ documentStub });

  const originalSetContent = page.setContent;
  let setContentAt = null;
  page.setContent = async (...args) => {
    setContentAt = Date.now();
    return originalSetContent.call(page, ...args);
  };

  const startedAt = Date.now();
  await applyPdfWaitOptions(page, {
    waitForTimeout: 50,
    extractIframeContent: '#frame',
  });

  assert.ok(setContentAt !== null, 'setContent should have been called');
  assert.ok(
    setContentAt - startedAt >= 45,
    `extract should run after waitForTimeout; elapsed=${setContentAt - startedAt}ms`,
  );
});

test('applyPdfWaitOptions: waitForSelector runs before extractIframeContent', async () => {
  const iframe = {
    contentDocument: {
      readyState: 'complete',
      documentElement: { outerHTML: '<html></html>' },
    },
  };
  const documentStub = { querySelector: () => iframe };
  const page = createPage({ documentStub });

  await applyPdfWaitOptions(page, {
    waitForSelector: '#frame',
    extractIframeContent: '#frame',
  });

  const waitIdx = page.calls.findIndex((c) => c.method === 'waitForSelector');
  const setContentIdx = page.calls.findIndex((c) => c.method === 'setContent');

  assert.ok(waitIdx !== -1 && setContentIdx !== -1);
  assert.ok(
    waitIdx < setContentIdx,
    `waitForSelector (idx=${waitIdx}) should run before extract setContent (idx=${setContentIdx})`,
  );
});

test('waitForFonts: resolves only after document.fonts.ready settles', async () => {
  let resolveReady;
  const documentStub = {
    fonts: { ready: new Promise((resolve) => { resolveReady = resolve; }) },
  };
  const page = createPage({ documentStub });

  let settled = false;
  const pending = waitForFonts(page).then(() => { settled = true; });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, 'must not resolve before fonts.ready');

  resolveReady();
  await pending;
  assert.equal(settled, true);
  assert.ok(page.calls.some((c) => c.method === 'evaluate'));
});

test('attachPageDiagnostics: logs failed requests and console errors at debug level', () => {
  const page = createPage();
  const entries = [];
  const logger = { debug: (context, message) => entries.push({ context, message }) };

  attachPageDiagnostics(page, logger);

  page.emit('requestfailed', {
    url: () => 'https://static.example.net/font.woff',
    failure: () => ({ errorText: 'net::ERR_FAILED' }),
  });
  page.emit('console', { type: () => 'error', text: () => 'blocked by CORS policy' });
  page.emit('console', { type: () => 'log', text: () => 'plain log noise' });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].message, 'Page request failed');
  assert.deepEqual(entries[0].context, {
    url: 'https://static.example.net/font.woff',
    reason: 'net::ERR_FAILED',
  });
  assert.equal(entries[1].message, 'Page console error');
  assert.deepEqual(entries[1].context, { message: 'blocked by CORS policy' });
});
