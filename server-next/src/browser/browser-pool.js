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

export class BrowserPool {
  constructor({ size, maxPagesPerBrowser, renderTimeoutMs }) {
    this.size = size;
    this.maxPagesPerBrowser = maxPagesPerBrowser;
    this.renderTimeoutMs = renderTimeoutMs;
    this.browsers = [];
    this.renderCount = [];
    this.roundRobinIndex = 0;
    this.limiter = pLimit(size);
    this.replacing = new Map();
  }

  async init() {
    for (let i = 0; i < this.size; i += 1) {
      this.browsers[i] = await puppeteer.launch(launchArgs);
      this.renderCount[i] = 0;
    }

    logger.info({ size: this.size }, 'Browser pool initialized');
  }

  async close() {
    await Promise.all(this.browsers.map(async (browser) => {
      if (!browser) return;
      try {
        await browser.close();
      } catch (error) {
        logger.warn({ err: error }, 'Failed to close browser');
      }
    }));
  }

  async usePage(worker) {
    return this.limiter(async () => {
      const idx = await this.getBrowserIndex();
      const browser = this.browsers[idx];
      const page = await browser.newPage();

      try {
        this.renderCount[idx] += 1;
        return await withTimeout(worker(page), this.renderTimeoutMs);
      } finally {
        try {
          await page.close();
        } catch (error) {
          logger.warn({ err: error }, 'Failed to close page');
        }

        if (this.renderCount[idx] >= this.maxPagesPerBrowser) {
          await this.replaceBrowser(idx);
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

    await this.replaceBrowser(idx);
    return idx;
  }

  async replaceBrowser(idx) {
    if (this.replacing.has(idx)) {
      await this.replacing.get(idx);
      return;
    }

    const promise = (async () => {
      const old = this.browsers[idx];
      try {
        if (old) {
          await old.close();
        }
      } catch (error) {
        logger.warn({ err: error }, 'Failed to close old browser');
      }

      this.browsers[idx] = await puppeteer.launch(launchArgs);
      this.renderCount[idx] = 0;
      logger.info({ idx }, 'Browser recycled');
    })();

    this.replacing.set(idx, promise);

    try {
      await promise;
    } finally {
      this.replacing.delete(idx);
    }
  }
}
