const logger = require('logger');

const {
  generateImageValidator,
  generatePdfValidator,
} = require('./validators');
const { getBrowser, closeBrowser, goToPage } = require('infrastructure/browser.helper');

module.exports.generatePdf = async (ctx) => {
  const result = await generatePdfValidator.validate(ctx);

  ctx.assert(!result.errors, 400);

  ctx.type = 'application/pdf';
  ctx.attachment('out.pdf');

  const { url, html, options, headers } = result.value;

  const opts = Object.assign({
    printBackground: true,
    margin: {
      top: '0.4in',
      right: '0.4in',
      bottom: '0.4in',
      left: '0.4in',
    },
  }, options);

  logger.info('URL: ', url);
  logger.debug('HTML: ', html);
  logger.debug('OPTIONS: ', opts);
  logger.debug('HEADERS: ', headers);

  const browser = await getBrowser();

  let page = null;
  try {
    page = await goToPage({
      browser,
      headers,
      url: url || 'data:text/html,<!DOCTYPE html><html lang="en">',
    });

    if (html) {
      await page.setContent(html);
    }

    if (typeof opts.emulateMediaType !== 'undefined' && opts.emulateMediaType) {
      await page.emulateMediaType(opts.emulateMediaType);
    }

    if (typeof opts.waitForSelector !== 'undefined' && opts.waitForSelector) {
      await page.waitForSelector(opts.waitForSelector, { visible: true, timeout: 60000 });
    }

    logger.debug('MAKE PDF');

    ctx.body = Buffer.from(await page.pdf(opts));

    await page.close();
  } catch (e) {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        await closeBrowser(browser);
      }
    }
    throw e;
  }
};

module.exports.generateImage = async (ctx) => {
  const result = await generateImageValidator.validate(ctx);

  ctx.assert(!result.errors, 400);

  const { url, html, options, headers } = result.value;

  const imageType = options.type || 'png';

  ctx.type = `image/${imageType}`;
  ctx.attachment(`out.${imageType}`);

  const browser = await getBrowser();

  logger.debug('URL: ', url);
  logger.debug('HTML: ', html);
  logger.debug('OPTIONS: ', options);
  logger.debug('HEADERS: ', headers);

  let page = null;
  try {
    page = await goToPage({
      browser,
      headers,
      url: url || 'data:text/html,<!DOCTYPE html><html lang="en">',
    });

    if (html) {
      await page.setContent(html);
    }
    
    logger.debug('MAKE IMAGE');

    ctx.body = Buffer.from(await page.screenshot({
      fullPage: true,
    }, options));

    await page.close();
  } catch (e) {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        await closeBrowser(browser);
      }
    }

    // await closeBrowser(browser);
    throw e;
  }
};
