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

export const navigate = async ({ page, url, html, headers, timeoutMs, waitUntil = 'networkidle0' }) => {
  if (headers && Object.keys(headers).length > 0) {
    await page.setExtraHTTPHeaders(headers);
  }

  page.setDefaultNavigationTimeout(timeoutMs);

  await page.goto(url ?? 'data:text/html,<!DOCTYPE html><html lang="en"></html>', {
    waitUntil,
    timeout: timeoutMs,
  });

  if (html) {
    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
  }
};

export const applyPdfWaitOptions = async (page, options = {}) => {
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

  if (options.waitForTimeout) {
    await sleep(options.waitForTimeout);
  }
};
