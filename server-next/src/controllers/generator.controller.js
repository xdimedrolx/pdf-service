import { applyPdfWaitOptions, defaultPdfOptions, navigate } from '../browser/render.js';

export const createGeneratorController = ({ browserPool, navigationTimeoutMs, logger }) => {
  const generatePdf = async ({ url, html, options, headers }) => {
    const pdfOptions = defaultPdfOptions(options);

    const fileBuffer = await browserPool.usePage(async (page) => {
      await navigate({
        page,
        url,
        html,
        headers,
        timeoutMs: navigationTimeoutMs,
        waitUntil: pdfOptions.waitUntil,
      });

      await applyPdfWaitOptions(page, pdfOptions);
      return page.pdf(pdfOptions);
    });

    logger.debug({ url }, 'PDF generated');

    return {
      fileName: 'out.pdf',
      contentType: 'application/pdf',
      buffer: fileBuffer,
    };
  };

  const generateImage = async ({ url, html, options = {}, headers }) => {
    const type = options.type ?? 'png';

    const fileBuffer = await browserPool.usePage(async (page) => {
      await navigate({
        page,
        url,
        html,
        headers,
        timeoutMs: navigationTimeoutMs,
      });

      return page.screenshot({
        fullPage: options.fullPage ?? true,
        ...options,
      });
    });

    logger.debug({ url, type }, 'Image generated');

    return {
      fileName: `out.${type}`,
      contentType: `image/${type}`,
      buffer: fileBuffer,
    };
  };

  return { generatePdf, generateImage };
};
