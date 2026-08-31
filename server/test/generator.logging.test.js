import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeneratorController } from '../src/controllers/generator.controller.js';

const createCapturingLogger = () => {
  const entries = [];
  return {
    entries,
    info(context, message) { entries.push({ level: 'info', context, message }); },
    debug(context, message) { entries.push({ level: 'debug', context, message }); },
    warn(context, message) { entries.push({ level: 'warn', context, message }); },
    error(context, message) { entries.push({ level: 'error', context, message }); },
  };
};

const createFakePage = () => ({
  on() {},
  async setRequestInterception() {},
  async setExtraHTTPHeaders() {},
  setDefaultNavigationTimeout() {},
  async goto() {},
  async setContent() {},
  async emulateMediaType() {},
  async waitForSelector() {},
  async evaluate() {},
  async pdf() { return Buffer.from('fake-pdf'); },
  async screenshot() { return Buffer.from('fake-image'); },
});

const createController = ({ failInPool = false } = {}) => {
  const browserPool = failInPool
    ? { async usePage() { throw new Error('browser exploded'); } }
    : { async usePage(worker) { return worker(createFakePage()); } };

  return createGeneratorController({
    browserPool,
    navigationTimeoutMs: 1_000,
    logger: createCapturingLogger(),
  });
};

test('generatePdf logs render start with url, options and header names, never header values', async () => {
  const controller = createController();
  const capture = createCapturingLogger();

  await controller.generatePdf(
    {
      url: 'https://example.com/report',
      options: { waitUntil: 'networkidle2', waitForTimeout: 50 },
      headers: { authorization: 'Bearer TOP-SECRET', 'login-token': 'ALSO-SECRET' },
    },
    { logger: capture },
  );

  const start = capture.entries.find((e) => e.message === 'PDF render started');
  assert.ok(start, 'should log a render start entry');
  assert.equal(start.level, 'info');
  assert.equal(start.context.url, 'https://example.com/report');
  assert.equal(start.context.options.waitUntil, 'networkidle2');
  assert.equal(start.context.options.waitForTimeout, 50);
  assert.deepEqual(start.context.headerNames, ['authorization', 'login-token']);

  const serialized = JSON.stringify(capture.entries);
  assert.ok(!serialized.includes('TOP-SECRET'), 'header values must never be logged');
  assert.ok(!serialized.includes('ALSO-SECRET'), 'header values must never be logged');
});

test('generatePdf logs html renders with byte size instead of content', async () => {
  const controller = createController();
  const capture = createCapturingLogger();
  const html = '<html><body>secret patient data</body></html>';

  await controller.generatePdf({ html }, { logger: capture });

  const start = capture.entries.find((e) => e.message === 'PDF render started');
  assert.equal(start?.context.htmlBytes, html.length);
  assert.ok(
    !JSON.stringify(capture.entries).includes('secret patient data'),
    'html content must never be logged',
  );
});

test('generatePdf logs completion at info with duration, size and page issues summary', async () => {
  const controller = createController();
  const capture = createCapturingLogger();

  await controller.generatePdf({ url: 'https://example.com/report' }, { logger: capture });

  const done = capture.entries.find((e) => e.message === 'PDF generated');
  assert.ok(done, 'should log a completion entry');
  assert.equal(done.level, 'info');
  assert.equal(done.context.url, 'https://example.com/report');
  assert.equal(typeof done.context.durationMs, 'number');
  assert.equal(done.context.bytes, Buffer.from('fake-pdf').length);
  assert.deepEqual(done.context.pageIssues, {
    failedRequests: 0,
    consoleErrors: 0,
    failedRequestUrls: [],
  });
});

test('generatePdf logs failures with duration alongside the error', async () => {
  const controller = createController({ failInPool: true });
  const capture = createCapturingLogger();

  await assert.rejects(
    controller.generatePdf({ url: 'https://example.com/report' }, { logger: capture }),
    /browser exploded/,
  );

  const failed = capture.entries.find((e) => e.message === 'PDF generation failed');
  assert.ok(failed, 'should log a failure entry');
  assert.equal(failed.level, 'error');
  assert.equal(failed.context.url, 'https://example.com/report');
  assert.equal(typeof failed.context.durationMs, 'number');
});

test('generateImage logs render start and completion with type and size', async () => {
  const controller = createController();
  const capture = createCapturingLogger();

  await controller.generateImage(
    { url: 'https://example.com/banner', options: { type: 'jpeg' } },
    { logger: capture },
  );

  const start = capture.entries.find((e) => e.message === 'Image render started');
  assert.equal(start?.level, 'info');
  assert.equal(start?.context.url, 'https://example.com/banner');

  const done = capture.entries.find((e) => e.message === 'Image generated');
  assert.equal(done?.level, 'info');
  assert.equal(done?.context.type, 'jpeg');
  assert.equal(typeof done?.context.durationMs, 'number');
  assert.equal(done?.context.bytes, Buffer.from('fake-image').length);
});
