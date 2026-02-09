import { serve } from '@hono/node-server';
import { config } from './config.js';
import { logger } from './logger.js';
import { BrowserPool } from './browser/browser-pool.js';
import { createGeneratorController } from './controllers/generator.controller.js';
import { createApp } from './app.js';

const browserPool = new BrowserPool({
  size: config.browserPoolSize,
  maxPagesPerBrowser: config.maxPagesPerBrowser,
  renderTimeoutMs: config.renderTimeoutMs,
});

await browserPool.init();

const controller = createGeneratorController({
  browserPool,
  navigationTimeoutMs: config.navigationTimeoutMs,
  logger,
});

const app = createApp({ controller });

const server = serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port,
});

logger.info({
  host: config.host,
  port: config.port,
  poolSize: config.browserPoolSize,
}, 'PDF service next started');

const shutdown = async (signal) => {
  logger.warn({ signal }, 'Shutdown started');
  server.close(async () => {
    await browserPool.close();
    logger.warn('Shutdown complete');
    process.exit(0);
  });
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown(signal).catch((error) => {
      logger.error({ err: error }, 'Failed to shutdown gracefully');
      process.exit(1);
    });
  });
}

process.on('uncaughtException', async (error) => {
  logger.error({ err: error }, 'uncaughtException');
  await browserPool.close();
  process.exit(1);
});
