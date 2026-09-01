import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { registerGeneratorRoutes } from './routes/generator.routes.js';
import { randomUUID } from 'node:crypto';
import {
  issuesToErrors,
  normalizeErrorToErrors,
  resolveErrorCode,
  resolveErrorStatus,
  serializeErrorDetails,
} from './validation/errors.js';
import { logger } from './logger.js';
import { runWithLogger } from './logger-context.js';

const getNodeMemoryUsageMiB = () => {
  const memory = process.memoryUsage();

  return {
    nodeRssMiB: Math.round(memory.rss / (1024 * 1024)),
    nodeHeapUsedMiB: Math.round(memory.heapUsed / (1024 * 1024)),
    nodeExternalMiB: Math.round(memory.external / (1024 * 1024)),
  };
};

export const createApp = ({ controller }) => {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (result.success) {
        return;
      }

      const requestLogger = c.get('logger') ?? logger;
      const correlationId = c.get('correlationId');
      const requestId = c.get('requestId');
      const errors = issuesToErrors(result.error.issues);

      requestLogger.warn({ errors }, 'Validation failed');

      return c.json({ correlationId, requestId, errors }, 400);
    },
  });

  app.use('*', async (c, next) => {
    // correlationId spans the whole call chain across services (taken from the
    // caller when provided); requestId identifies this one request in this
    // service and is always generated locally.
    const correlationId = c.req.header('x-correlation-id') ?? randomUUID();
    const requestId = randomUUID();
    const requestLogger = logger.child({ correlationId, requestId });

    c.set('correlationId', correlationId);
    c.set('requestId', requestId);
    c.set('logger', requestLogger);
    c.header('x-correlation-id', correlationId);
    c.header('x-request-id', requestId);

    requestLogger.info({
      method: c.req.method,
      path: c.req.path,
      query: c.req.query(),
    }, 'Incoming request');

    const startedAt = Date.now();
    try {
      await runWithLogger(requestLogger, () => next());
    } finally {
      requestLogger.info({
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - startedAt,
        ...getNodeMemoryUsageMiB(),
      }, 'Request completed');
    }
  });

  app.get('/health', (c) => c.json({ ok: true }));

  registerGeneratorRoutes(app, controller);

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'PDF Service',
      version: '1.4.0',
    },
  });

  app.get('/docs', swaggerUI({ url: '/openapi.json' }));

  app.onError((error, c) => {
    const requestLogger = c.get('logger') ?? logger;
    const correlationId = c.get('correlationId');
    const requestId = c.get('requestId');
    const errors = normalizeErrorToErrors(error);
    const details = serializeErrorDetails(error);
    const code = resolveErrorCode(error);
    const status = resolveErrorStatus(error);

    requestLogger.error({ err: error, errors, details }, 'Unhandled error');

    return c.json({ correlationId, requestId, code, errors, details }, status);
  });

  return app;
};
