import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createGeneratorController } from '../src/controllers/generator.controller.js';

const createFakeBrowserPool = ({ failOnWaitForSelector = false } = {}) => {
  const calls = [];

  const page = {
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
    async evaluate() {
      calls.push({ method: 'evaluate' });
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

const createTestApp = ({ failOnWaitForSelector = false } = {}) => {
  const browserPool = createFakeBrowserPool({ failOnWaitForSelector });
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
