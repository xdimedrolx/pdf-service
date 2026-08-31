import {
  applyPdfWaitOptions,
  attachPageDiagnostics,
  defaultPdfOptions,
  navigate,
  waitForFonts,
} from '../browser/render.js';

export const createGeneratorController = ({
  browserPool,
  navigationTimeoutMs,
  logger,
}) => {
  const generatePdf = async ({ url, html, options, headers }, context = {}) => {
    const requestLogger = context.logger ?? logger;
    const pdfOptions = defaultPdfOptions(options);
    const startedAt = Date.now();
    let pageIssues = null;

    requestLogger.info({
      url,
      htmlBytes: html?.length,
      options: pdfOptions,
      headerNames: Object.keys(headers ?? {}),
    }, 'PDF render started');

    try {
      const fileBuffer = await browserPool.usePage(async (page) => {
        pageIssues = attachPageDiagnostics(page, requestLogger);
        await navigate({
          page,
          url,
          html,
          headers,
          timeoutMs: navigationTimeoutMs,
          waitUntil: pdfOptions.waitUntil,
        });

        await applyPdfWaitOptions(page, pdfOptions);
        await waitForFonts(page);
        return page.pdf(pdfOptions);
      });

      requestLogger.info({
        url,
        durationMs: Date.now() - startedAt,
        bytes: fileBuffer.length,
        pageIssues,
      }, 'PDF generated');

      return {
        fileName: 'out.pdf',
        contentType: 'application/pdf',
        buffer: fileBuffer,
      };
    } catch (error) {
      requestLogger.error({
        err: error,
        url,
        durationMs: Date.now() - startedAt,
        pageIssues,
      }, 'PDF generation failed');
      throw error;
    }
  };

  const generateImage = async ({ url, html, options = {}, headers }, context = {}) => {
    const requestLogger = context.logger ?? logger;
    const type = options.type ?? 'png';
    const startedAt = Date.now();
    let pageIssues = null;

    requestLogger.info({
      url,
      htmlBytes: html?.length,
      options,
      headerNames: Object.keys(headers ?? {}),
    }, 'Image render started');

    try {
      const fileBuffer = await browserPool.usePage(async (page) => {
        pageIssues = attachPageDiagnostics(page, requestLogger);
        await navigate({
          page,
          url,
          html,
          headers,
          timeoutMs: navigationTimeoutMs,
        });

        await waitForFonts(page);
        return page.screenshot({
          fullPage: options.fullPage ?? true,
          ...options,
        });
      });

      requestLogger.info({
        url,
        type,
        durationMs: Date.now() - startedAt,
        bytes: fileBuffer.length,
        pageIssues,
      }, 'Image generated');

      return {
        fileName: `out.${type}`,
        contentType: `image/${type}`,
        buffer: fileBuffer,
      };
    } catch (error) {
      requestLogger.error({
        err: error,
        url,
        type,
        durationMs: Date.now() - startedAt,
        pageIssues,
      }, 'Image generation failed');
      throw error;
    }
  };

  return { generatePdf, generateImage };
};
