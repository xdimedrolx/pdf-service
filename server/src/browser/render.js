import { setTimeout as sleep } from 'node:timers/promises';
import { AppError } from '../errors/app-error.js';

export const defaultPdfOptions = (options = {}) => ({
  printBackground: true,
  margin: {
    top: '0.4in',
    right: '0.4in',
    bottom: '0.4in',
    left: '0.4in',
  },
  ...options,
});

// Attaching caller headers to every request (setExtraHTTPHeaders) turns cross-origin
// CORS-mode fetches (webfonts) into preflighted requests, which CDNs commonly reject.
// Headers are therefore scoped to the page origin via request interception.
const applyHeadersToOrigin = async (page, headers, origin) => {
  await page.setRequestInterception(true);

  page.on('request', (request) => {
    if (request.isInterceptResolutionHandled()) {
      return;
    }

    let sameOrigin = false;
    try {
      sameOrigin = new URL(request.url()).origin === origin;
    } catch {
      // non-hierarchical URL (data:, about:) — never same-origin
    }

    const overrides = sameOrigin
      ? { headers: { ...request.headers(), ...headers } }
      : undefined;

    // continue() rejects when the page is torn down mid-render; the request is gone anyway
    request.continue(overrides).catch(() => {});
  });
};

export const navigate = async ({ page, url, html, headers, timeoutMs, waitUntil }) => {
  if (headers && Object.keys(headers).length > 0) {
    if (url) {
      await applyHeadersToOrigin(page, headers, new URL(url).origin);
    } else {
      await page.setExtraHTTPHeaders(headers);
    }
  }

  page.setDefaultNavigationTimeout(timeoutMs);

  if (url) {
    await page.goto(url, {
      waitUntil: waitUntil ?? 'networkidle0',
      timeout: timeoutMs,
    });
  }

  if (html) {
    // setContent must run on a page that has not navigated yet: after a real
    // navigation Chromium never re-emits the networkIdle lifecycle event for
    // the synthetic navigation setContent performs, so networkidle waits hang
    // until the timeout. Pool pages are fresh, so pure html mode is safe; for
    // the url+html combo the networkidle wait is downgraded to 'load'.
    const contentWaitUntil = waitUntil ?? 'domcontentloaded';
    await page.setContent(html, {
      waitUntil: url && contentWaitUntil.startsWith('networkidle') ? 'load' : contentWaitUntil,
      timeout: timeoutMs,
    });
  }
};

// font-display: swap paints fallback glyphs first; without this wait the snapshot
// can be taken before webfonts finish loading. Failed fonts settle too, so this
// never blocks on unreachable font hosts.
export const waitForFonts = async (page) => {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
};

// Per-event details go to debug; the returned stats let callers surface a
// summary (counts + first failed urls) in info/error logs, so blocked
// resources are visible in production without debug-level noise.
export const attachPageDiagnostics = (page, logger) => {
  const stats = { failedRequests: 0, consoleErrors: 0, failedRequestUrls: [] };

  page.on('requestfailed', (request) => {
    stats.failedRequests += 1;
    if (stats.failedRequestUrls.length < 3) {
      stats.failedRequestUrls.push(request.url());
    }
    logger.debug({ url: request.url(), reason: request.failure()?.errorText }, 'Page request failed');
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      stats.consoleErrors += 1;
      logger.debug({ message: message.text() }, 'Page console error');
    }
  });

  return stats;
};

export const applyPdfWaitOptions = async (page, options = {}) => {
  if (options.waitForSelector) {
    const selectorTimeoutMs = options.waitForSelectorTimeoutMs ?? 30_000;
    try {
      await page.waitForSelector(options.waitForSelector, {
        visible: true,
        timeout: selectorTimeoutMs,
      });
    } catch (error) {
      throw new AppError({
        status: 504,
        code: 'WAIT_FOR_SELECTOR_TIMEOUT',
        message: `Timed out waiting for selector ${options.waitForSelector}`,
        details: {
          selector: options.waitForSelector,
          timeoutMs: selectorTimeoutMs,
        },
        cause: error,
      });
    }
  }

  if (options.waitIframeLoading) {
    await page.evaluate(async (selector) => {
      const iframe = document.querySelector(selector);
      if (!iframe || !iframe.contentDocument) {
        return;
      }
      if (iframe.contentDocument.readyState === 'complete') {
        return;
      }

      await new Promise((resolve) => {
        iframe.addEventListener('load', () => resolve(), { once: true });
      });
    }, options.waitIframeLoading);
  }

  if (options.waitForTimeout) {
    await sleep(options.waitForTimeout);
  }

  if (options.extractIframeContent) {
    const innerHtml = await page.evaluate(async (selector) => {
      const iframe = document.querySelector(selector);
      if (!iframe || !iframe.contentDocument) {
        return null;
      }

      if (iframe.contentDocument.readyState !== 'complete') {
        await new Promise((resolve) => {
          iframe.addEventListener('load', () => resolve(), { once: true });
        });
      }

      return iframe.contentDocument.documentElement.outerHTML;
    }, options.extractIframeContent);

    if (innerHtml) {
      await page.setContent(innerHtml, { waitUntil: 'domcontentloaded' });
    }
  }

  if (options.emulateMediaType) {
    await page.emulateMediaType(options.emulateMediaType);
  }

  if (options.fitIframeToContent) {
    await page.evaluate(async (selector) => {
      const iframe = document.querySelector(selector);
      if (!iframe || !iframe.contentDocument) {
        return;
      }

      if (iframe.contentDocument.readyState !== 'complete') {
        await new Promise((resolve) => {
          iframe.addEventListener('load', () => resolve(), { once: true });
        });
      }

      iframe.style.height = `${iframe.contentDocument.body.scrollHeight}px`;
    }, options.fitIframeToContent);
  }
};
