import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('loadConfig: returns defaults when env is empty', () => {
  const cfg = loadConfig({});

  assert.equal(cfg.env, 'development');
  assert.equal(cfg.host, '0.0.0.0');
  assert.equal(cfg.port, 3000);
  assert.equal(cfg.navigationTimeoutMs, 45_000);
  assert.equal(cfg.renderTimeoutMs, 60_000);
  assert.equal(cfg.browserPoolSize, 1);
  assert.equal(cfg.maxPagesPerBrowser, 50);
});

test('loadConfig: parses numeric env vars', () => {
  const cfg = loadConfig({
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: '4000',
    BROWSER_POOL_SIZE: '4',
    BROWSER_MAX_PAGES_PER_INSTANCE: '100',
    NAVIGATION_TIMEOUT_MS: '5000',
    RENDER_TIMEOUT_MS: '6000',
  });

  assert.equal(cfg.env, 'production');
  assert.equal(cfg.host, '127.0.0.1');
  assert.equal(cfg.port, 4000);
  assert.equal(cfg.browserPoolSize, 4);
  assert.equal(cfg.maxPagesPerBrowser, 100);
  assert.equal(cfg.navigationTimeoutMs, 5000);
  assert.equal(cfg.renderTimeoutMs, 6000);
});

test('loadConfig: falls back to defaults on garbage and empty values', () => {
  const cfg = loadConfig({ PORT: 'abc', BROWSER_POOL_SIZE: '' });

  assert.equal(cfg.port, 3000);
  assert.equal(cfg.browserPoolSize, 1);
});

test('loadConfig: clamps browserPoolSize and maxPagesPerBrowser to >= 1', () => {
  const cfg = loadConfig({ BROWSER_POOL_SIZE: '0', BROWSER_MAX_PAGES_PER_INSTANCE: '0' });

  assert.equal(cfg.browserPoolSize, 1);
  assert.equal(cfg.maxPagesPerBrowser, 1);
});
