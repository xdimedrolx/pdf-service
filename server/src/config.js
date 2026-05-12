const parseIntOrDefault = (raw, fallback) => {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

export const loadConfig = (env = process.env) => ({
  env: env.NODE_ENV ?? 'development',
  host: env.HOST ?? '0.0.0.0',
  port: parseIntOrDefault(env.PORT, 3000),
  navigationTimeoutMs: parseIntOrDefault(env.NAVIGATION_TIMEOUT_MS, 180_000),
  renderTimeoutMs: parseIntOrDefault(env.RENDER_TIMEOUT_MS, 180_000),
  browserPoolSize: Math.max(1, parseIntOrDefault(env.BROWSER_POOL_SIZE, 1)),
  maxPagesPerBrowser: Math.max(1, parseIntOrDefault(env.BROWSER_MAX_PAGES_PER_INSTANCE, 50)),
});

export const config = loadConfig();
