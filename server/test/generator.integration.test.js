import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createGeneratorController } from '../src/controllers/generator.controller.js';

const createFakeBrowserPool = ({ failOnWaitForSelector = false } = {}) => {
  const calls = [];

  const page = {
    on(event) {
      calls.push({ method: 'on', value: event });
    },
    async setRequestInterception(value) {
      calls.push({ method: 'setRequestInterception', value });
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
    },
    async pdf(options) {
      calls.push({ method: 'pdf', value: options });
      return Buffer.from('fake-pdf');
    },
    async screenshot(options) {
      calls.push({ method: 'screenshot', value: options });
      return Buffer.from('fake-image');
    },
  };

  return {
    calls,
    async usePage(worker) {
      return worker(page);
    },
  };
};

const createTestApp = ({ failOnWaitForSelector = false, throwGenericError = false } = {}) => {
  const fakePool = createFakeBrowserPool({ failOnWaitForSelector });

  const browserPool = throwGenericError
    ? {
      calls: fakePool.calls,
      async usePage() {
        throw new Error('something exploded');
      },
    }
    : fakePool;

  const controller = createGeneratorController({
    browserPool,
    navigationTimeoutMs: 1_000,
    logger: {
      debug() {},
      error() {},
    },
  });

  return {
    app: createApp({ controller }),
    browserPool,
  };
};

test('POST /pdf returns binary pdf and attachment headers', async () => {
  const { app, browserPool } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<html><body><h1>Hello</h1></body></html>',
      headers: { authorization: 'Bearer token' },
      options: { printBackground: true, waitUntil: 'networkidle0' },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="out.pdf"');

  const payload = Buffer.from(await response.arrayBuffer()).toString('utf8');
  assert.equal(payload, 'fake-pdf');

  const headersCall = browserPool.calls.find((call) => call.method === 'setExtraHTTPHeaders');
  assert.deepEqual(headersCall?.value, { authorization: 'Bearer token' });
});

test('POST /image returns binary image and attachment headers', async () => {
  const { app } = createTestApp();

  const response = await app.request('/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<html><body><h1>Hello</h1></body></html>',
      options: { type: 'jpeg', quality: 80, fullPage: false },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="out.jpeg"');

  const payload = Buffer.from(await response.arrayBuffer()).toString('utf8');
  assert.equal(payload, 'fake-image');
});

test('POST /pdf returns 400 when url and html are missing', async () => {
  const { app } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);

  const body = await response.json();
  assert.ok(Array.isArray(body.errors));
  assert.ok(body.errors.length > 0);
});

test('POST /pdf returns 504 for waitForSelector timeout with code and correlation id', async () => {
  const { app } = createTestApp({ failOnWaitForSelector: true });

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<html><body><h1>Hello</h1></body></html>',
      options: { waitForSelector: '#paymentActContainer' },
    }),
  });

  assert.equal(response.status, 504);

  const body = await response.json();
  assert.equal(body.code, 'WAIT_FOR_SELECTOR_TIMEOUT');
  assert.equal(typeof body.correlationId, 'string');
  assert.equal(body.details.selector, '#paymentActContainer');
  assert.equal(body.details.timeoutMs, 30000);
  assert.ok(Array.isArray(body.errors));
  assert.ok(body.errors.length > 0);
});

test('POST /pdf with url scopes caller headers via request interception', async () => {
  const { app, browserPool } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.com/report',
      headers: { authorization: 'Bearer token' },
    }),
  });

  assert.equal(response.status, 200);

  const interceptionCall = browserPool.calls.find((call) => call.method === 'setRequestInterception');
  assert.equal(interceptionCall?.value, true);
  assert.equal(
    browserPool.calls.find((call) => call.method === 'setExtraHTTPHeaders'),
    undefined,
    'url mode must not apply caller headers globally',
  );
});

test('POST /pdf with url calls goto with the url', async () => {
  const { app, browserPool } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: 'https://example.com/report',
      options: { printBackground: false },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');

  const gotoCall = browserPool.calls.find((call) => call.method === 'goto');
  assert.equal(gotoCall?.value.url, 'https://example.com/report');
});

test('POST /image returns 400 when url and html are missing', async () => {
  const { app } = createTestApp();

  const response = await app.request('/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);

  const body = await response.json();
  assert.ok(Array.isArray(body.errors));
  assert.ok(body.errors.some((entry) => Object.values(entry).some((message) => /url or html/.test(message))));
});

test('POST /pdf waits for webfonts before rendering the pdf', async () => {
  const { app, browserPool } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ html: '<html><body>text</body></html>' }),
  });

  assert.equal(response.status, 200);

  const evaluateIndex = browserPool.calls.findIndex((call) => call.method === 'evaluate');
  const pdfIndex = browserPool.calls.findIndex((call) => call.method === 'pdf');
  assert.ok(evaluateIndex !== -1, 'fonts wait should call page.evaluate');
  assert.ok(evaluateIndex < pdfIndex, 'fonts wait should run before page.pdf');
});

test('POST /image waits for webfonts before taking the screenshot', async () => {
  const { app, browserPool } = createTestApp();

  const response = await app.request('/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ html: '<html><body>text</body></html>' }),
  });

  assert.equal(response.status, 200);

  const evaluateIndex = browserPool.calls.findIndex((call) => call.method === 'evaluate');
  const screenshotIndex = browserPool.calls.findIndex((call) => call.method === 'screenshot');
  assert.ok(evaluateIndex !== -1, 'fonts wait should call page.evaluate');
  assert.ok(evaluateIndex < screenshotIndex, 'fonts wait should run before page.screenshot');
});

test('GET /health returns ok', async () => {
  const { app } = createTestApp();

  const response = await app.request('/health');

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true });
});

test('correlation id from request header propagates to response header and body', async () => {
  const { app } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': 'fixed-id-123',
    },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);
  assert.equal(response.headers.get('x-correlation-id'), 'fixed-id-123');

  const body = await response.json();
  assert.equal(body.correlationId, 'fixed-id-123');
});

test('correlation id is auto-generated when request does not provide one', async () => {
  const { app } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

  const headerId = response.headers.get('x-correlation-id');
  assert.ok(headerId && headerId.length > 0);
  const body = await response.json();
  assert.equal(body.correlationId, headerId);
});

test('POST /pdf returns 400 when options has unknown field (strict schema)', async () => {
  const { app } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<html></html>',
      options: { unknownField: 'x' },
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(Array.isArray(body.errors));
  assert.ok(body.errors.length > 0);
});

test('POST /pdf returns 500 with INTERNAL_ERROR code for generic errors', async () => {
  const { app } = createTestApp({ throwGenericError: true });

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ html: '<html></html>' }),
  });

  assert.equal(response.status, 500);

  const body = await response.json();
  assert.equal(body.code, 'INTERNAL_ERROR');
  assert.equal(typeof body.correlationId, 'string');
  assert.ok(Array.isArray(body.errors));
  assert.equal(body.details?.name, 'Error');
});

test('POST /pdf with fitIframeToContent passes the selector to page.evaluate', async () => {
  const { app, browserPool } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<html><body><iframe id="chart"></iframe></body></html>',
      options: { fitIframeToContent: '#chart' },
    }),
  });

  assert.equal(response.status, 200);

  const evaluateCall = browserPool.calls.find((call) => call.method === 'evaluate');
  assert.equal(evaluateCall?.value, '#chart');
});

test('POST /pdf returns 400 when fitIframeToContent is not a string', async () => {
  const { app } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<html></html>',
      options: { fitIframeToContent: 123 },
    }),
  });

  assert.equal(response.status, 400);

  const body = await response.json();
  assert.ok(Array.isArray(body.errors));
  assert.ok(
    body.errors.some((entry) => Object.keys(entry).some((path) => path.includes('fitIframeToContent'))),
    `expected an error entry referencing fitIframeToContent, got ${JSON.stringify(body.errors)}`,
  );
});

test('POST /pdf with extractIframeContent passes the selector to page.evaluate', async () => {
  const { app, browserPool } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<html><body><iframe id="report"></iframe></body></html>',
      options: { extractIframeContent: '#report' },
    }),
  });

  assert.equal(response.status, 200);

  const evaluateCall = browserPool.calls.find((call) => call.method === 'evaluate');
  assert.equal(evaluateCall?.value, '#report');
});

test('POST /pdf returns 400 when extractIframeContent is not a string', async () => {
  const { app } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<html></html>',
      options: { extractIframeContent: false },
    }),
  });

  assert.equal(response.status, 400);

  const body = await response.json();
  assert.ok(Array.isArray(body.errors));
  assert.ok(
    body.errors.some((entry) => Object.keys(entry).some((path) => path.includes('extractIframeContent'))),
    `expected an error entry referencing extractIframeContent, got ${JSON.stringify(body.errors)}`,
  );
});

test('every request gets its own generated x-request-id, independent of x-correlation-id', async () => {
  const { app } = createTestApp();

  const send = () => app.request('/pdf', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': 'chain-1',
      'x-request-id': 'ignored-external-value',
    },
    body: JSON.stringify({ html: '<html></html>' }),
  });

  const first = await send();
  const second = await send();

  const firstRequestId = first.headers.get('x-request-id');
  const secondRequestId = second.headers.get('x-request-id');

  assert.ok(firstRequestId && firstRequestId.length > 0, 'x-request-id header must be set');
  assert.notEqual(firstRequestId, 'ignored-external-value', 'request id is always generated locally');
  assert.notEqual(firstRequestId, secondRequestId, 'each request gets a fresh request id');

  assert.equal(first.headers.get('x-correlation-id'), 'chain-1');
  assert.equal(second.headers.get('x-correlation-id'), 'chain-1');
});

test('error responses include both correlationId and requestId', async () => {
  const { app } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);

  const body = await response.json();
  assert.equal(typeof body.correlationId, 'string');
  assert.equal(typeof body.requestId, 'string');
  assert.equal(body.requestId, response.headers.get('x-request-id'));
});
