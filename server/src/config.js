const parseIntOrDefault = (raw, fallback) => {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

export const loadConfig = (env = process.env) => ({
  env: env.NODE_ENV ?? 'development',
  host: env.HOST ?? '0.0.0.0',
  port: parseIntOrDefault(env.PORT, 3000),
  // Callers give up long before 3 minutes (the chaika backend HTTP client waits
  // 60s), so anything slower only burns a pool browser for a client that is
  // already gone. Navigation gets a tighter budget for precise attribution.
  navigationTimeoutMs: parseIntOrDefault(env.NAVIGATION_TIMEOUT_MS, 45_000),
  renderTimeoutMs: parseIntOrDefault(env.RENDER_TIMEOUT_MS, 60_000),
  browserPoolSize: Math.max(1, parseIntOrDefault(env.BROWSER_POOL_SIZE, 1)),
  maxPagesPerBrowser: Math.max(1, parseIntOrDefault(env.BROWSER_MAX_PAGES_PER_INSTANCE, 50)),
});

export const config = loadConfig();
