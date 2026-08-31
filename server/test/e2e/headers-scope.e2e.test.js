import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BrowserPool } from '../../src/browser/browser-pool.js';
import { createGeneratorController } from '../../src/controllers/generator.controller.js';
import { createApp } from '../../src/app.js';

// Regression for the vaccination-certificate font bug: caller headers applied via
// setExtraHTTPHeaders were attached to every request, which turned cross-origin
// CORS-mode fetches (webfonts) into preflighted requests. CDNs that reject
// OPTIONS (403) then blocked the fonts while no-cors resources kept working.
// Caller headers must reach the page origin only.

const silentLogger = {
  info() {}, warn() {}, debug() {}, error() {},
  child() { return silentLogger; },
};

const PDF_MAGIC = '%PDF';
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let pool;
let app;
let pageServer;
let pageOrigin;
let cdnServer;
let cdnOrigin;
let pageRequests = [];
let cdnRequests = [];

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

  // Third-party host mimicking the font CDN: GETs carry CORS headers,
  // OPTIONS (preflight) is rejected the way object storages / CDNs do.
  cdnServer = createServer((req, res) => {
    cdnRequests.push({ method: req.method, url: req.url, headers: req.headers });

    if (req.method === 'OPTIONS') {
      res.statusCode = 403;
      res.end();
      return;
    }

    if (req.url === '/data.json') {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
      return;
    }

    if (req.url === '/pixel.png') {
      res.setHeader('content-type', 'image/png');
      res.end(PIXEL_PNG);
      return;
    }

    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => cdnServer.listen(0, '127.0.0.1', resolve));
  cdnOrigin = `http://127.0.0.1:${cdnServer.address().port}`;

  // Page origin: the host the caller authenticates against.
  pageServer = createServer((req, res) => {
    pageRequests.push({ method: req.method, url: req.url, headers: req.headers });

    if (req.url === '/page') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        '<!DOCTYPE html><html><body>'
        + '<h1>headers scope</h1>'
        + `<img src="${cdnOrigin}/pixel.png">`
        + `<script>fetch('${cdnOrigin}/data.json').catch(() => {});</script>`
        + '</body></html>',
      );
      return;
    }

    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => pageServer.listen(0, '127.0.0.1', resolve));
  pageOrigin = `http://127.0.0.1:${pageServer.address().port}`;
});

after(async () => {
  await pool.close();
  await new Promise((resolve) => pageServer.close(() => resolve()));
  await new Promise((resolve) => cdnServer.close(() => resolve()));
});

test('caller headers reach the page origin but never third-party hosts', async () => {
  pageRequests = [];
  cdnRequests = [];

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${pageOrigin}/page`,
      headers: { authorization: 'Basic c2VjcmV0', 'login-token': 'secret-token' },
      options: { waitUntil: 'networkidle0' },
    }),
  });

  assert.equal(response.status, 200);
  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 4).toString('utf8'), PDF_MAGIC);

  const documentRequest = pageRequests.find((entry) => entry.url === '/page');
  assert.equal(documentRequest?.headers.authorization, 'Basic c2VjcmV0');
  assert.equal(documentRequest?.headers['login-token'], 'secret-token');

  for (const entry of cdnRequests) {
    assert.equal(
      entry.headers.authorization,
      undefined,
      `authorization leaked to third-party host: ${entry.method} ${entry.url}`,
    );
    assert.equal(
      entry.headers['login-token'],
      undefined,
      `login-token leaked to third-party host: ${entry.method} ${entry.url}`,
    );
  }
});

test('cross-origin CORS fetch stays simple (no preflight) and succeeds', async () => {
  pageRequests = [];
  cdnRequests = [];

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${pageOrigin}/page`,
      headers: { authorization: 'Basic c2VjcmV0' },
      options: { waitUntil: 'networkidle0' },
    }),
  });

  assert.equal(response.status, 200);

  const preflights = cdnRequests.filter((entry) => entry.method === 'OPTIONS');
  assert.equal(
    preflights.length,
    0,
    `caller headers must not trigger CORS preflights, got: ${JSON.stringify(preflights.map((p) => p.url))}`,
  );
  assert.ok(
    cdnRequests.some((entry) => entry.method === 'GET' && entry.url === '/data.json'),
    'the CORS-mode fetch should succeed as a simple GET',
  );
});
