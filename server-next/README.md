# server-next

Новая реализация PDF генератора на современных библиотеках.

## Стек

- `hono` + `@hono/node-server`
- `@hono/zod-openapi` + `@hono/swagger-ui`
- `puppeteer`
- `pino`

## Запуск

```bash
cd server-next
npm install
npm run start
```

## Docker

Сборка образа:

```bash
cd server-next
docker build -t pdf-service-next .
```

Запуск контейнера:

```bash
docker run --rm -p 4444:3000 pdf-service-next
```

Запуск через compose:

```bash
cd server-next
docker compose up --build
```

### Автоматизация release образа

В директории есть `Makefile` и файл `VERSION`.

Показать текущую версию:

```bash
cd server-next
make version
```

Установить версию:

```bash
make set-version VERSION=0.7.0
```

Собрать и отправить образ:

```bash
make docker-release
```

По умолчанию используется репозиторий `xdimedrolx/pdf-service`.
Можно переопределить:

```bash
make docker-release IMAGE=myrepo/pdf-service VERSION=0.7.1
```

## API

- `POST /pdf`
- `POST /image`
- `GET /health`
- `GET /openapi.json`
- `GET /docs`

Контракт входных параметров сохранен как в текущем `server`:

- `url?: string`
- `html?: string`
- `options?: object`
- `headers?: Record<string, string>`

Требуется минимум одно поле: `url` или `html`.

### `POST /pdf` options

`path`, `scale`, `displayHeaderFooter`, `headerTemplate`, `footerTemplate`, `printBackground`, `landscape`, `pageRanges`, `format`, `width`, `height`, `waitForSelector`, `waitIframeLoading`, `waitForTimeout`, `waitUntil`, `emulateMediaType`, `margin`.

### `POST /image` options

`path`, `type` (`png`/`jpeg`), `quality`, `fullPage`, `omitBackground`, `clip`.

## Анти-OOM

- Пул браузеров (`BROWSER_POOL_SIZE`, по умолчанию 2).
- Ограничение параллелизма на уровне пула.
- Рециклинг браузера после лимита рендеров (`BROWSER_MAX_PAGES_PER_INSTANCE`, по умолчанию 200).
- Таймаут рендера (`RENDER_TIMEOUT_MS`).

## Переменные окружения

- `HOST` (default `0.0.0.0`)
- `PORT` (default `3000`)
- `BROWSER_POOL_SIZE` (default `2`)
- `BROWSER_MAX_PAGES_PER_INSTANCE` (default `200`)
- `NAVIGATION_TIMEOUT_MS` (default `180000`)
- `RENDER_TIMEOUT_MS` (default `180000`)
- `LOG_LEVEL`
