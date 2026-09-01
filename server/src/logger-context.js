import { AsyncLocalStorage } from 'node:async_hooks';
import { logger as rootLogger } from './logger.js';

// Carries the request-scoped logger (a pino child with correlationId) through
// the async call chain, so code that is not wired to the request context —
// the browser pool above all — still logs with the request's correlationId.
const storage = new AsyncLocalStorage();

export const runWithLogger = (loggerInstance, fn) => storage.run(loggerInstance, fn);

export const getLogger = (fallback = rootLogger) => storage.getStore() ?? fallback;
