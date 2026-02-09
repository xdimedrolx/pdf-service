import { createRoute, z } from '@hono/zod-openapi';
import { errorSchema, generateImageSchema, generatePdfSchema } from '../validation/schemas.js';

const binary = z.string().openapi({ type: 'string', format: 'binary' });

const pdfRoute = createRoute({
  method: 'post',
  path: '/pdf',
  tags: ['generator'],
  summary: 'Generate PDF',
  request: {
    body: {
      content: {
        'application/json': {
          schema: generatePdfSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'PDF binary',
      content: {
        'application/pdf': {
          schema: binary,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: errorSchema,
        },
      },
    },
    500: {
      description: 'Internal error',
      content: {
        'application/json': {
          schema: errorSchema,
        },
      },
    },
  },
});

const imageRoute = createRoute({
  method: 'post',
  path: '/image',
  tags: ['generator'],
  summary: 'Generate image',
  request: {
    body: {
      content: {
        'application/json': {
          schema: generateImageSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Image binary',
      content: {
        'image/png': {
          schema: binary,
        },
        'image/jpeg': {
          schema: binary,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: errorSchema,
        },
      },
    },
    500: {
      description: 'Internal error',
      content: {
        'application/json': {
          schema: errorSchema,
        },
      },
    },
  },
});

export const registerGeneratorRoutes = (app, controller) => {
  app.openapi(pdfRoute, async (c) => {
    const payload = c.req.valid('json');
    const result = await controller.generatePdf(payload, {
      logger: c.get('logger'),
      correlationId: c.get('correlationId'),
    });

    c.header('Content-Type', result.contentType);
    c.header('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return c.body(result.buffer);
  });

  app.openapi(imageRoute, async (c) => {
    const payload = c.req.valid('json');
    const result = await controller.generateImage(payload, {
      logger: c.get('logger'),
      correlationId: c.get('correlationId'),
    });

    c.header('Content-Type', result.contentType);
    c.header('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return c.body(result.buffer);
  });
};
