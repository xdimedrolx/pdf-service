import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { registerGeneratorRoutes } from './routes/generator.routes.js';
import { issuesToErrors } from './validation/errors.js';
import { logger } from './logger.js';

export const createApp = ({ controller }) => {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (result.success) {
        return;
      }
      return c.json({ errors: issuesToErrors(result.error.issues) }, 400);
    },
  });

  app.use('*', async (c, next) => {
    const startedAt = Date.now();
    await next();

    logger.info({
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    }, 'Request processed');
  });

  app.get('/health', (c) => c.json({ ok: true }));

  registerGeneratorRoutes(app, controller);

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'PDF Service Next',
      version: '1.0.0',
    },
  });

  app.get('/docs', swaggerUI({ url: '/openapi.json' }));

  app.onError((error, c) => {
    logger.error({ err: error }, 'Unhandled error');
    return c.json({ errors: [{ _global: 'An error has occurred' }] }, 500);
  });

  return app;
};
