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

    try {
      const fileBuffer = await browserPool.usePage(async (page) => {
        attachPageDiagnostics(page, requestLogger);
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

      requestLogger.debug({ url }, 'PDF generated');

      return {
        fileName: 'out.pdf',
        contentType: 'application/pdf',
        buffer: fileBuffer,
      };
    } catch (error) {
      requestLogger.error({ err: error, url }, 'PDF generation failed');
      throw error;
    }
  };

  const generateImage = async ({ url, html, options = {}, headers }, context = {}) => {
    const requestLogger = context.logger ?? logger;
    const type = options.type ?? 'png';

    try {
      const fileBuffer = await browserPool.usePage(async (page) => {
        attachPageDiagnostics(page, requestLogger);
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

      requestLogger.debug({ url, type }, 'Image generated');

      return {
        fileName: `out.${type}`,
        contentType: `image/${type}`,
        buffer: fileBuffer,
      };
    } catch (error) {
      requestLogger.error({ err: error, url, type }, 'Image generation failed');
      throw error;
    }
  };

  return { generatePdf, generateImage };
};
