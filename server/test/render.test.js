import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPdfWaitOptions, defaultPdfOptions, navigate } from '../src/browser/render.js';
import { AppError } from '../src/errors/app-error.js';

const createPage = ({ failOnWaitForSelector = false, documentStub = null } = {}) => {
  const calls = [];

  return {
    calls,
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

test('navigate: sets extra headers when provided', async () => {
  const page = createPage();

  await navigate({ page, url: 'http://example.com', headers: { authorization: 'Bearer x' }, timeoutMs: 1000 });

  const headersCall = page.calls.find((c) => c.method === 'setExtraHTTPHeaders');
  assert.deepEqual(headersCall?.value, { authorization: 'Bearer x' });
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
