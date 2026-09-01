import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPool } from '../src/browser/browser-pool.js';

const createFakeLogger = () => ({
  info() {},
  warn() {},
  debug() {},
});

const createLaunchBrowserStub = () => {
  const launchedBrowsers = [];

  return {
    launchedBrowsers,
    async launchBrowser() {
      const browserIndex = launchedBrowsers.length;

      const browser = {
        connected: true,
        async newPage() {
          return {
            async setCacheEnabled() {},
            async close() {},
          };
        },
        async close() {
          browser.connected = false;
        },
        process() {
          return { pid: 1000 + browserIndex };
        },
      };

      launchedBrowsers.push(browser);
      return browser;
    },
  };
};

test('BrowserPool recycles browser after reaching max page limit', async () => {
  const launchStub = createLaunchBrowserStub();
  const pool = new BrowserPool({
    size: 1,
    maxPagesPerBrowser: 2,
    renderTimeoutMs: 1_000,
    launchBrowser: () => launchStub.launchBrowser(),
    loggerInstance: createFakeLogger(),
  });

  await pool.init();
  await pool.usePage(async () => 'first');
  await pool.usePage(async () => 'second');

  assert.equal(launchStub.launchedBrowsers.length, 2);
  await pool.close();
});

test('BrowserPool recycles browser after failed render', async () => {
  const launchStub = createLaunchBrowserStub();
  const pool = new BrowserPool({
    size: 1,
    maxPagesPerBrowser: 10,
    renderTimeoutMs: 1_000,
    launchBrowser: () => launchStub.launchBrowser(),
    loggerInstance: createFakeLogger(),
  });

  await pool.init();

  await assert.rejects(
    pool.usePage(async () => {
      throw new Error('boom');
    }),
    /boom/,
  );

  assert.equal(launchStub.launchedBrowsers.length, 2);
  await pool.close();
});

test('BrowserPool replaces browser when current one is disconnected', async () => {
  const launchStub = createLaunchBrowserStub();
  const pool = new BrowserPool({
    size: 1,
    maxPagesPerBrowser: 10,
    renderTimeoutMs: 1_000,
    launchBrowser: () => launchStub.launchBrowser(),
    loggerInstance: createFakeLogger(),
  });

  await pool.init();
  pool.browsers[0].connected = false;

  const result = await pool.usePage(async () => 'ok');

  assert.equal(result, 'ok');
  assert.equal(launchStub.launchedBrowsers.length, 2);
  await pool.close();
});

test('BrowserPool rejects with render timeout and recycles browser', async () => {
  const launchStub = createLaunchBrowserStub();
  const pool = new BrowserPool({
    size: 1,
    maxPagesPerBrowser: 10,
    renderTimeoutMs: 20,
    launchBrowser: () => launchStub.launchBrowser(),
    loggerInstance: createFakeLogger(),
  });

  await pool.init();

  await assert.rejects(
    pool.usePage(() => new Promise((resolve) => setTimeout(() => resolve('late'), 200))),
    /Render timeout/,
  );

  assert.equal(launchStub.launchedBrowsers.length, 2);
  await pool.close();
});

test('BrowserPool logs render failures through the request-scoped logger when inside a context', async () => {
  const { runWithLogger } = await import('../src/logger-context.js');
  const launchStub = createLaunchBrowserStub();
  const instanceEntries = [];
  const requestEntries = [];
  const instanceLogger = {
    info() {}, debug() {},
    warn(context, message) { instanceEntries.push({ context, message }); },
  };
  const requestLogger = {
    info() {}, debug() {},
    warn(context, message) { requestEntries.push({ context, message }); },
  };

  const pool = new BrowserPool({
    size: 1,
    maxPagesPerBrowser: 10,
    renderTimeoutMs: 1_000,
    launchBrowser: () => launchStub.launchBrowser(),
    loggerInstance: instanceLogger,
  });
  await pool.init();

  await assert.rejects(
    runWithLogger(requestLogger, () => pool.usePage(async () => {
      throw new Error('boom');
    })),
    /boom/,
  );

  const failureLog = requestEntries.find((e) => e.message === 'Render failed, browser will be recycled');
  assert.ok(failureLog, 'render failure must be logged through the request-scoped logger');
  assert.equal(
    instanceEntries.find((e) => e.message === 'Render failed, browser will be recycled'),
    undefined,
    'render failure must not fall back to the pool instance logger inside a request context',
  );

  await pool.close();
});
