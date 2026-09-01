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

const countPdfPages = (buffer) => {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 0;
};

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

    if (req.url === '/with-iframe') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        '<!DOCTYPE html><html><body style="margin:0;">'
        + '<iframe id="frame" src="/tall" style="width:100%;height:400px;border:0;"></iframe>'
        + '</body></html>'
      );
      return;
    }

    if (req.url === '/tall') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      let html = '<!DOCTYPE html><html><body style="margin:0;">';
      for (let i = 0; i < 30; i += 1) {
        html += `<p style="height:100px;margin:0;background:#eee;">Block ${i}</p>`;
      }
      html += '</body></html>';
      res.end(html);
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

test('POST /pdf control: tall iframe without fitIframeToContent produces a single-page PDF', async () => {
  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${staticServerUrl}/with-iframe`,
      options: { waitIframeLoading: '#frame', format: 'A4' },
    }),
  });

  assert.equal(response.status, 200);

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 4).toString('utf8'), PDF_MAGIC);
  assert.equal(countPdfPages(buffer), 1);
});

test('POST /pdf with fitIframeToContent paginates over the full iframe content', async () => {
  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${staticServerUrl}/with-iframe`,
      options: { fitIframeToContent: '#frame', format: 'A4' },
    }),
  });

  assert.equal(response.status, 200);

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 4).toString('utf8'), PDF_MAGIC);
  const pageCount = countPdfPages(buffer);
  assert.ok(pageCount >= 2, `expected >= 2 pages, got ${pageCount}`);
});

test('POST /pdf with extractIframeContent renders only the iframe inner document', async () => {
  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${staticServerUrl}/with-iframe`,
      options: { extractIframeContent: '#frame', format: 'A4' },
    }),
  });

  assert.equal(response.status, 200);

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 4).toString('utf8'), PDF_MAGIC);
  const pageCount = countPdfPages(buffer);
  assert.ok(pageCount >= 2, `expected >= 2 pages, got ${pageCount}`);
});

test('POST /pdf with HTML + srcdoc iframe and fitIframeToContent paginates correctly', async () => {
  const inner = '<!DOCTYPE html><html><body style="margin:0;font-family:sans-serif;">'
    + Array.from({ length: 30 }, (_, i) =>
      `<div style="height:80px;padding:8px;background:${i % 2 ? '#fff' : '#eef'};">Block ${i}</div>`
    ).join('')
    + '</body></html>';

  const srcdocAttr = inner.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const parent = '<!DOCTYPE html><html><body style="margin:0;padding:20px;">'
    + `<iframe id="frame" style="width:100%;height:400px;border:2px solid #333;" srcdoc="${srcdocAttr}"></iframe>`
    + '</body></html>';

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: parent,
      options: { fitIframeToContent: '#frame', format: 'A4' },
    }),
  });

  assert.equal(response.status, 200);

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 4).toString('utf8'), PDF_MAGIC);
  const pageCount = countPdfPages(buffer);
  assert.ok(pageCount >= 2, `expected >= 2 pages for srcdoc iframe, got ${pageCount}`);
});

test('POST /pdf with html and waitUntil networkidle0 renders without hanging', async () => {
  const startedAt = Date.now();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<!DOCTYPE html><html><body><h1>networkidle html</h1></body></html>',
      options: { format: 'A5', waitUntil: 'networkidle0' },
    }),
  });

  assert.equal(response.status, 200);
  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 4).toString('utf8'), PDF_MAGIC);
  assert.ok(
    Date.now() - startedAt < 30_000,
    `render should finish promptly, took ${Date.now() - startedAt}ms`,
  );
});
