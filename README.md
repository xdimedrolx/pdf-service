# pdf-service

PDF and image generator service built on Puppeteer. Fork of [paralect/pdf-service](https://github.com/paralect/pdf-service), rewritten on a modern stack.

## Stack

- `hono` + `@hono/node-server`
- `@hono/zod-openapi` + `@hono/swagger-ui`
- `puppeteer`
- `pino`

## Run

```bash
cd server
npm install
npm run start
```

Tests:

```bash
cd server
npm test
```

## Docker

Build image (from repo root):

```bash
docker build -t pdf-service ./server
```

Run container:

```bash
docker run --rm -p 4444:3000 pdf-service
```

Run via compose (from repo root):

```bash
docker compose up --build
```

### Release image automation

The repo root contains a `Makefile` and a `VERSION` file.

Show current version:

```bash
make version
```

Set version:

```bash
make set-version VERSION=1.0.0
```

Build and push image:

```bash
make docker-release
```

Default image repository is `xdimedrolx/pdf-service`. Override:

```bash
make docker-release IMAGE=myrepo/pdf-service VERSION=1.0.1
```

## API

- `POST /pdf`
- `POST /image`
- `GET /health`
- `GET /openapi.json`
- `GET /docs`

Input contract matches the original `paralect/pdf-service`:

- `url?: string`
- `html?: string`
- `options?: object`
- `headers?: Record<string, string>`

At least one of `url` or `html` is required.

`headers` are attached only to requests going to the origin of `url` (the page itself, its redirects, same-origin assets and XHR). Third-party hosts (CDNs, font/static hosts, analytics) never see them — attaching custom headers to cross-origin CORS requests (e.g. webfonts) would force a CORS preflight, which many CDNs reject, silently breaking fonts. In `html` mode there is no page origin, so headers apply to all requests (legacy behavior).

`options.waitUntil` applies to both modes: page navigation for `url`, content loading for `html` (`domcontentloaded` by default). Before rendering, the service additionally waits for `document.fonts.ready` so webfonts are never raced by the snapshot.

### `POST /pdf` options

`path`, `scale`, `displayHeaderFooter`, `headerTemplate`, `footerTemplate`, `printBackground`, `landscape`, `pageRanges`, `format`, `width`, `height`, `waitForSelector`, `waitForSelectorTimeoutMs` (default `30000`), `waitIframeLoading`, `fitIframeToContent`, `extractIframeContent`, `waitForTimeout`, `waitUntil`, `emulateMediaType`, `margin`.

#### Iframe options

Two options handle iframes whose inner content is taller than the iframe's CSS height:

- `fitIframeToContent: "<selector>"` — resizes the matched iframe to its `body.scrollHeight` so its content can paginate across multiple PDF pages. **Limitation:** Chromium treats iframes as monolithic replaced elements, so the iframe always starts at a fresh page boundary — any parent content before the iframe occupies its own pages, and the iframe content begins on the next page (possibly leaving a gap). The iframe's own CSS is preserved.
- `extractIframeContent: "<selector>"` — replaces the entire parent document with the iframe's inner document before rendering. Parent wrapper (titles, surrounding HTML) is discarded; the PDF paginates over the iframe content only with no monolithic-element constraints. Use this when you want clean pagination and the parent wrapper is not part of the output.

Both options require the iframe to be same-origin (`contentDocument` accessible). Missing selectors and cross-origin iframes are silently ignored.

### `POST /image` options

`path`, `type` (`png`/`jpeg`), `quality`, `fullPage`, `omitBackground`, `clip`.

## Anti-OOM

- Browser pool (`BROWSER_POOL_SIZE`, default `1`).
- Concurrency limit at the pool level.
- Browser recycling after a render limit (`BROWSER_MAX_PAGES_PER_INSTANCE`, default `50`).
- Forced browser recycling after a failed render or timeout.
- Render timeout (`RENDER_TIMEOUT_MS`).
- Startup and recycle logs include browser PIDs and a Node.js memory snapshot.

## Environment variables

- `HOST` (default `0.0.0.0`)
- `PORT` (default `3000`)
- `BROWSER_POOL_SIZE` (default `1`)
- `BROWSER_MAX_PAGES_PER_INSTANCE` (default `50`)
- `NAVIGATION_TIMEOUT_MS` (default `45000`) — page navigation / content loading budget
- `RENDER_TIMEOUT_MS` (default `60000`) — hard cap for a whole render; keep it at or below your HTTP client's timeout, otherwise the pool keeps burning a browser for a caller that has already given up
- `LOG_LEVEL`

## Errors

- All errors are logged with a `correlationId`.
- `correlationId` is returned to the client in the `x-correlation-id` header and in the error body.
- For `waitForSelector` timeout the response is:
  - HTTP `504`
  - `code: "WAIT_FOR_SELECTOR_TIMEOUT"`
  - `details: { selector, timeoutMs }`

## License

MIT — see [LICENSE.md](LICENSE.md). Original work © Paralect.
