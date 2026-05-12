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

### `POST /pdf` options

`path`, `scale`, `displayHeaderFooter`, `headerTemplate`, `footerTemplate`, `printBackground`, `landscape`, `pageRanges`, `format`, `width`, `height`, `waitForSelector`, `waitForSelectorTimeoutMs` (default `30000`), `waitIframeLoading`, `waitForTimeout`, `waitUntil`, `emulateMediaType`, `margin`.

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
- `NAVIGATION_TIMEOUT_MS` (default `180000`)
- `RENDER_TIMEOUT_MS` (default `180000`)
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
