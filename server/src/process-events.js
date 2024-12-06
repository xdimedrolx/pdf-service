const { getBrowser, closeBrowser } = require('./infrastructure/browser.helper');

process.on('uncaughtException', async (err) => {
  console.log('uncaughtException', err);
  const browser = await getBrowser();
  await closeBrowser(browser);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received.');
  const browser = await getBrowser();
  await closeBrowser(browser);
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received.');
  const browser = await getBrowser();
  await closeBrowser(browser);
});
