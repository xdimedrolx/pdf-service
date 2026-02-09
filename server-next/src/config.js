const parseIntOrDefault = (raw, fallback) => {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: parseIntOrDefault(process.env.PORT, 3000),
  navigationTimeoutMs: parseIntOrDefault(process.env.NAVIGATION_TIMEOUT_MS, 180_000),
  renderTimeoutMs: parseIntOrDefault(process.env.RENDER_TIMEOUT_MS, 180_000),
  browserPoolSize: Math.max(1, parseIntOrDefault(process.env.BROWSER_POOL_SIZE, 2)),
  maxPagesPerBrowser: Math.max(1, parseIntOrDefault(process.env.BROWSER_MAX_PAGES_PER_INSTANCE, 200)),
};
