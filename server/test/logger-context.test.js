import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { getLogger, runWithLogger } from '../src/logger-context.js';

test('getLogger returns the fallback outside of any context', () => {
  const fallback = { name: 'fallback' };

  assert.equal(getLogger(fallback), fallback);
});

test('getLogger returns the bound logger inside runWithLogger, across await boundaries', async () => {
  const bound = { name: 'request-logger' };

  const seen = await runWithLogger(bound, async () => {
    await sleep(5);
    return getLogger({ name: 'fallback' });
  });

  assert.equal(seen, bound);
});

test('concurrent contexts do not leak loggers into each other', async () => {
  const first = { name: 'first' };
  const second = { name: 'second' };

  const [seenFirst, seenSecond] = await Promise.all([
    runWithLogger(first, async () => {
      await sleep(10);
      return getLogger();
    }),
    runWithLogger(second, async () => {
      await sleep(5);
      return getLogger();
    }),
  ]);

  assert.equal(seenFirst, first);
  assert.equal(seenSecond, second);
});
