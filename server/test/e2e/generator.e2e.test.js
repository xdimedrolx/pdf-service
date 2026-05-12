import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BrowserPool } from '../../src/browser/browser-pool.js';
import { createGeneratorController } from '../../src/controllers/generator.controller.js';
import { createApp } from '../../src/app.js';

const silentLogger = {
  info() {}, warn() {}, debug() {}, error() {},
  child() { return silentLogger; },
};

let pool;
let app;
let staticServer;
let staticServerUrl;
let receivedRequests = [];

const PDF_MAGIC = '%PDF';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

before(async () => {
  pool = new BrowserPool({
    size: 1,
    maxPagesPerBrowser: 50,
    renderTimeoutMs: 60_000,
    loggerInstance: silentLogger,
  });
  await pool.init();

  const controller = createGeneratorController({
    browserPool: pool,
    navigationTimeoutMs: 60_000,
    logger: silentLogger,
  });

  app = createApp({ controller });

  staticServer = createServer((req, res) => {
    receivedRequests.push({ url: req.url, headers: req.headers });

    if (req.url === '/hello') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!DOCTYPE html><html><body><h1>Hello E2E</h1></body></html>');
      return;
    }

    if (req.url === '/with-selector') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!DOCTYPE html><html><body><div id="ready">ready</div></body></html>');
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise((resolve) => staticServer.listen(0, '127.0.0.1', resolve));
  const address = staticServer.address();
  staticServerUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await pool.close();
  await new Promise((resolve) => staticServer.close(() => resolve()));
});

test('POST /pdf with html returns valid PDF bytes', async () => {
  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<!DOCTYPE html><html><body><h1>Hello PDF</h1></body></html>',
      options: { format: 'A4' },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 4).toString('utf8'), PDF_MAGIC);
  assert.ok(buffer.length > 500, `expected real PDF (> 500 bytes), got ${buffer.length}`);
});

test('POST /image returns PNG by default', async () => {
  const response = await app.request('/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<!DOCTYPE html><html><body><h1>Hello PNG</h1></body></html>',
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(buffer.subarray(0, 4), PNG_MAGIC);
});

test('POST /image with type=jpeg returns JPEG', async () => {
  const response = await app.request('/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<!DOCTYPE html><html><body><h1>Hello JPEG</h1></body></html>',
      options: { type: 'jpeg', quality: 70 },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(buffer.subarray(0, 3), JPEG_MAGIC);
});

test('POST /pdf with url fetches page from upstream server', async () => {
  receivedRequests = [];

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: `${staticServerUrl}/hello` }),
  });

  assert.equal(response.status, 200);

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 4).toString('utf8'), PDF_MAGIC);

  const hit = receivedRequests.find((entry) => entry.url === '/hello');
  assert.ok(hit, 'upstream server should have received /hello');
});

test('POST /pdf forwards request headers to upstream', async () => {
  receivedRequests = [];

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${staticServerUrl}/hello`,
      headers: { 'x-custom-header': 'e2e-value' },
    }),
  });

  assert.equal(response.status, 200);

  const hit = receivedRequests.find((entry) => entry.url === '/hello');
  assert.equal(hit?.headers['x-custom-header'], 'e2e-value');
});

test('POST /pdf with waitForSelector that exists succeeds', async () => {
  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${staticServerUrl}/with-selector`,
      options: { waitForSelector: '#ready', waitForSelectorTimeoutMs: 5_000 },
    }),
  });

  assert.equal(response.status, 200);
  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 4).toString('utf8'), PDF_MAGIC);
});

test('POST /pdf with missing waitForSelector returns 504 WAIT_FOR_SELECTOR_TIMEOUT', async () => {
  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${staticServerUrl}/hello`,
      options: { waitForSelector: '#never-appears', waitForSelectorTimeoutMs: 1_500 },
    }),
  });

  assert.equal(response.status, 504);

  const body = await response.json();
  assert.equal(body.code, 'WAIT_FOR_SELECTOR_TIMEOUT');
  assert.equal(body.details.selector, '#never-appears');
  assert.equal(body.details.timeoutMs, 1_500);
});

test('concurrent /pdf requests are serialized through the pool and all succeed', async () => {
  const sendPdf = () => app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<!DOCTYPE html><html><body><h1>Concurrent</h1></body></html>',
    }),
  });

  const responses = await Promise.all([sendPdf(), sendPdf(), sendPdf()]);

  for (const response of responses) {
    assert.equal(response.status, 200);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.equal(buffer.subarray(0, 4).toString('utf8'), PDF_MAGIC);
  }
});
