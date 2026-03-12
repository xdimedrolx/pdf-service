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
