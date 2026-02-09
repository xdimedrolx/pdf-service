import { z } from '@hono/zod-openapi';

const baseBodySchema = z.object({
  url: z.string().url().optional(),
  html: z.string().optional(),
  headers: z.record(z.string()).optional(),
}).strict();

const pdfOptionsSchema = z.object({
  path: z.string().optional(),
  scale: z.number().optional(),
  displayHeaderFooter: z.boolean().optional(),
  headerTemplate: z.string().optional(),
  footerTemplate: z.string().optional(),
  printBackground: z.boolean().optional(),
  landscape: z.boolean().optional(),
  pageRanges: z.string().optional(),
  format: z.string().optional(),
  width: z.string().optional(),
  height: z.string().optional(),
  waitForSelector: z.string().optional(),
  waitIframeLoading: z.string().optional(),
  waitForTimeout: z.number().optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional(),
  emulateMediaType: z.enum(['print', 'screen']).optional(),
  margin: z.object({
    top: z.string().optional(),
    right: z.string().optional(),
    bottom: z.string().optional(),
    left: z.string().optional(),
  }).optional(),
}).strict().optional();

const imageOptionsSchema = z.object({
  path: z.string().optional(),
  type: z.enum(['png', 'jpeg']).optional(),
  quality: z.number().min(0).max(100).optional(),
  fullPage: z.boolean().optional(),
  omitBackground: z.boolean().optional(),
  clip: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  }).optional(),
}).strict().optional();

const withEitherUrlOrHtml = (schema) => schema.superRefine((value, ctx) => {
  if (!value.url && !value.html) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['_global'],
      message: 'Either url or html is required',
    });
  }
});

export const generatePdfSchema = withEitherUrlOrHtml(baseBodySchema.extend({ options: pdfOptionsSchema }));

export const generateImageSchema = withEitherUrlOrHtml(baseBodySchema.extend({ options: imageOptionsSchema }));

export const errorSchema = z.object({
  correlationId: z.string().optional(),
  errors: z.array(z.record(z.string())),
  details: z.object({
    name: z.string(),
    message: z.string(),
    stack: z.string().nullable(),
  }).optional(),
});
