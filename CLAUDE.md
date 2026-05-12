# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

Fork of `paralect/pdf-service` with a from-scratch reimplementation. The Node application lives in [server/](server/); the repo root holds release/infra tooling that targets `./server` as the build context:

- [server/](server/) — application source, tests, Dockerfile, package.json
- [Makefile](Makefile), [VERSION](VERSION), [docker-compose.yml](docker-compose.yml) — release/image automation at the root

All `npm` commands run from `server/`. Docker builds run from the repo root with `./server` as context. The CI workflow ([.github/workflows/ci.yml](.github/workflows/ci.yml)) uses `defaults.run.working-directory: server` for this reason.

## Commands

From `server/`:
- `npm run start` — start the service
- `npm run dev` — start with `node --watch`
- `npm test` — fast unit tests (mocked, no browser), `test/*.test.js` only
- `npm run test:e2e` — real Chromium end-to-end tests under `test/e2e/`; requires Puppeteer's bundled Chromium
- `npm run test:all` — unit + e2e
- Single file: `node --test test/render.test.js`
- Single test by name: `node --test --test-name-pattern "correlation id" test/generator.integration.test.js`

From the repo root:
- `make dev` — wrapper for `cd server && npm run dev` (native `node --watch`)
- `make dev-docker` — `docker compose up --build` with [docker-compose.dev.yml](docker-compose.dev.yml) merged in; bind-mounts `server/src/` and runs `node --watch` inside the container, with `NODE_ENV=development` and `LOG_LEVEL=debug`
- `docker build -t pdf-service ./server`
- `docker compose up --build` — prod-style compose without the dev override
- `make version` — print the current version
- `make set-version VERSION=X` — write [VERSION](VERSION) **and** sync `server/package.json`
- `make tag-release` — create + push `v$VERSION` git tag (triggers the Release workflow)
- `make docker-release [VERSION=X] [IMAGE=repo/name]` — manual Docker Hub push (escape hatch; CI publishes to ghcr.io automatically)

The unit suite (`npm test`) does not require Chromium — set `PUPPETEER_SKIP_DOWNLOAD=true` when reinstalling deps to skip the ~170MB browser download, which is what the CI `test` job does. The CI `e2e` job installs Chromium and runs `npm run test:e2e`.

## Architecture

Wiring is factory-based and dependency-injected. [server/src/index.js](server/src/index.js) is the only place that constructs the real instances:

```
BrowserPool → createGeneratorController({ browserPool, ... }) → createApp({ controller })
```

Each layer accepts its collaborators as parameters, which is why tests can inject fake pools/controllers without spinning up Puppeteer or Hono internals.

### Request flow

1. `app.use('*', ...)` in [server/src/app.js](server/src/app.js) resolves a `correlationId` (from the `x-correlation-id` header or `randomUUID()`), attaches a child pino logger to the Hono context, and echoes the id back in the response header.
2. The route handler in [server/src/routes/generator.routes.js](server/src/routes/generator.routes.js) validates the body via `@hono/zod-openapi` and calls `controller.generatePdf` / `generateImage`.
3. The controller in [server/src/controllers/generator.controller.js](server/src/controllers/generator.controller.js) reserves a page via `browserPool.usePage(worker)` — the pool guarantees the page is closed and the browser recycled if anything goes wrong.
4. Page work happens in [server/src/browser/render.js](server/src/browser/render.js): `navigate` (url-or-html + headers) followed by `applyPdfWaitOptions` (selector wait, media emulation, iframe load, fixed delay).

### Error handling — single shape

All errors are normalized in [server/src/app.js](server/src/app.js):
- **Validation failures** → `defaultHook` returns 400 with `{ correlationId, errors }`.
- **Thrown errors** → `app.onError` returns `{ correlationId, code, errors, details }` at the status derived from the error.

[server/src/errors/app-error.js](server/src/errors/app-error.js) is the canonical way to signal a specific HTTP status + code (e.g. `WAIT_FOR_SELECTOR_TIMEOUT` → 504 with `{ selector, timeoutMs }`). Plain `Error` instances fall through to 500 with `code: "INTERNAL_ERROR"`. [server/src/validation/errors.js](server/src/validation/errors.js) holds the normalization helpers (`resolveErrorStatus`, `resolveErrorCode`, `serializeErrorDetails`).

When adding a new business error, throw `AppError` — do not catch and re-shape responses in route handlers.

### Anti-OOM invariant — the browser pool is the safety boundary

[server/src/browser/browser-pool.js](server/src/browser/browser-pool.js) treats every Puppeteer interaction as suspect and recycles aggressively:
- After **max pages** (`BROWSER_MAX_PAGES_PER_INSTANCE`), recycle.
- After a **failed render**, recycle (`recycleReason: 'render-failed'`).
- After a **render timeout** (`RENDER_TIMEOUT_MS`, enforced by `withTimeout`), recycle (`render-timeout`).
- If a browser reports `connected === false`, replace it before handing it out.

Concurrency is bounded by `p-limit(size)`. Replacement is dedup'd via `this.replacing: Map<idx, Promise>` so concurrent failures don't double-launch. Do not add code paths that reuse a browser after an error — that defeats the design.

### Validation schemas are strict

Both `generatePdfSchema` and `generateImageSchema` in [server/src/validation/schemas.js](server/src/validation/schemas.js) use `.strict()`, and the cross-field `url || html` requirement is enforced via `superRefine`. Unknown option fields (typos, removed fields) are rejected at 400 — adding a new option means adding it to the schema.

## Testing conventions

All tests use `node:test`. Two tiers:

**Unit (`test/*.test.js`)** — mocked, fast, no browser:
- [server/test/browser-pool.test.js](server/test/browser-pool.test.js) — passes a `launchBrowser` stub to the `BrowserPool` constructor.
- [server/test/generator.integration.test.js](server/test/generator.integration.test.js) — passes a fake `browserPool` with a `calls` array; runs against the real Hono app via `app.request(...)`.
- [server/test/render.test.js](server/test/render.test.js) — fake `page` with a `calls` array.
- [server/test/config.test.js](server/test/config.test.js) — uses `loadConfig(env)` with synthetic env objects; do not mutate `process.env`.

**E2E (`test/e2e/*.test.js`)** — real Chromium, real `BrowserPool`, real `createApp`:
- [server/test/e2e/generator.e2e.test.js](server/test/e2e/generator.e2e.test.js) launches a real browser pool, stands up a local `http.createServer` for url-based tests, and asserts PDF/PNG/JPEG magic bytes from `app.request(...)`. Lifecycle uses top-level `before`/`after` to share the pool across tests.

E2E tests are gated to the `test/e2e/` directory so they never run under `npm test`. Mirror that split when adding new tests — anything that touches Chromium goes under `test/e2e/`.

## Versioning and release

[VERSION](VERSION) is the source of truth for the published image tag. `make set-version VERSION=X` keeps it in sync with `server/package.json`. The OpenAPI document version in [server/src/app.js](server/src/app.js) is a separate hardcoded string and should be updated at the same time.

Release flow:

1. `make set-version VERSION=X` — updates VERSION and `server/package.json`.
2. Commit the bump (and any release notes work).
3. `make tag-release` — creates and pushes an annotated `v$VERSION` tag. The Makefile refuses to tag if the working tree is dirty, the tag exists, or VERSION/package.json disagree.
4. The push of `v*` triggers [.github/workflows/release.yml](.github/workflows/release.yml), which re-validates versions, runs unit + e2e tests, pushes the Docker image to `ghcr.io/<owner>/<repo>` (tags: `X.Y.Z`, `X.Y`, `X`, `latest`), and creates a GitHub Release with auto-generated notes.

`make docker-release` still pushes to Docker Hub manually for cases where the CI path is not the right channel.
