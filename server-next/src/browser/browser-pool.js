import pLimit from 'p-limit';
import puppeteer from 'puppeteer';
import { logger } from '../logger.js';

const launchArgs = {
  headless: true,
  ignoreHTTPSErrors: true,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-setuid-sandbox',
    '--no-first-run',
    '--no-zygote',
    '--deterministic-fetch',
  ],
};

const withTimeout = async (promise, timeoutMs) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Render timeout ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const defaultLaunchBrowser = () => puppeteer.launch(launchArgs);

const getNodeMemoryUsageMiB = () => {
  const memory = process.memoryUsage();

  return {
    nodeRssMiB: Math.round(memory.rss / (1024 * 1024)),
    nodeHeapUsedMiB: Math.round(memory.heapUsed / (1024 * 1024)),
    nodeExternalMiB: Math.round(memory.external / (1024 * 1024)),
  };
};

export class BrowserPool {
  constructor({
    size,
    maxPagesPerBrowser,
    renderTimeoutMs,
    launchBrowser = defaultLaunchBrowser,
    loggerInstance = logger,
  }) {
    this.size = size;
    this.maxPagesPerBrowser = maxPagesPerBrowser;
    this.renderTimeoutMs = renderTimeoutMs;
    this.launchBrowser = launchBrowser;
    this.logger = loggerInstance;
    this.browsers = [];
    this.renderCount = [];
    this.roundRobinIndex = 0;
    this.limiter = pLimit(size);
    this.replacing = new Map();
  }

  async init() {
    const browserPids = [];

    for (let i = 0; i < this.size; i += 1) {
      this.browsers[i] = await this.launchBrowser();
      this.renderCount[i] = 0;
      browserPids.push(this.browsers[i]?.process?.()?.pid ?? null);
    }

    this.logger.info({
      size: this.size,
      maxPagesPerBrowser: this.maxPagesPerBrowser,
      browserPids,
      ...getNodeMemoryUsageMiB(),
    }, 'Browser pool initialized');
  }

  async close() {
    await Promise.all(this.browsers.map(async (browser) => {
      if (!browser) return;
      try {
        await browser.close();
      } catch (error) {
        this.logger.warn({ err: error }, 'Failed to close browser');
      }
    }));
  }

  async usePage(worker) {
    return this.limiter(async () => {
      const idx = await this.getBrowserIndex();
      const browser = this.browsers[idx];
      const page = await browser.newPage();
      const browserPid = browser?.process?.()?.pid ?? null;
      const startedAt = Date.now();
      let recycleReason = null;

      try {
        if (typeof page.setCacheEnabled === 'function') {
          await page.setCacheEnabled(false);
        }

        this.renderCount[idx] += 1;
        return await withTimeout(worker(page), this.renderTimeoutMs);
      } catch (error) {
        recycleReason = error.message?.startsWith('Render timeout')
          ? 'render-timeout'
          : 'render-failed';

        this.logger.warn({
          idx,
          browserPid,
          renderCount: this.renderCount[idx],
          durationMs: Date.now() - startedAt,
          queueActiveCount: this.limiter.activeCount,
          queuePendingCount: this.limiter.pendingCount,
          ...getNodeMemoryUsageMiB(),
          err: error,
        }, 'Render failed, browser will be recycled');

        throw error;
      } finally {
        try {
          await page.close();
        } catch (error) {
          this.logger.warn({ err: error }, 'Failed to close page');
        }

        if (recycleReason) {
          await this.replaceBrowser(idx, recycleReason);
        } else if (this.renderCount[idx] >= this.maxPagesPerBrowser) {
          await this.replaceBrowser(idx, 'max-pages');
        } else {
          this.logger.debug({
            idx,
            browserPid,
            renderCount: this.renderCount[idx],
            durationMs: Date.now() - startedAt,
            queueActiveCount: this.limiter.activeCount,
            queuePendingCount: this.limiter.pendingCount,
            ...getNodeMemoryUsageMiB(),
          }, 'Render completed');
        }
      }
    });
  }

  async getBrowserIndex() {
    const idx = this.roundRobinIndex;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % this.size;

    const browser = this.browsers[idx];
    if (browser?.connected) {
      return idx;
    }

    await this.replaceBrowser(idx, 'browser-disconnected');
    return idx;
  }

  async replaceBrowser(idx, reason = 'manual') {
    if (this.replacing.has(idx)) {
      await this.replacing.get(idx);
      return;
    }

    const promise = (async () => {
      const old = this.browsers[idx];
      const oldPid = old?.process?.()?.pid ?? null;
      const completedRenders = this.renderCount[idx] ?? 0;

      try {
        if (old) {
          await old.close();
        }
      } catch (error) {
        this.logger.warn({
          idx,
          reason,
          oldPid,
          completedRenders,
          err: error,
        }, 'Failed to close old browser');
      }

      this.browsers[idx] = await this.launchBrowser();
      this.renderCount[idx] = 0;
      this.logger.info({
        idx,
        reason,
        oldPid,
        newPid: this.browsers[idx]?.process?.()?.pid ?? null,
        completedRenders,
        ...getNodeMemoryUsageMiB(),
      }, 'Browser recycled');
    })();

    this.replacing.set(idx, promise);

    try {
      await promise;
    } finally {
      this.replacing.delete(idx);
    }
  }
}
