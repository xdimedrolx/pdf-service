# Migration: `server` -> `server-next`

Этот документ описывает безопасный переход со старой реализации (`server`) на новую (`server-next`).

## Что сохраняется

- Те же ключевые эндпоинты:
  - `POST /pdf`
  - `POST /image`
- Тот же контракт body-параметров в контроллере:
  - `url?: string`
  - `html?: string`
  - `options?: object`
  - `headers?: Record<string, string>`
- Требование: должен быть передан хотя бы один из `url` или `html`.
- Формат успешного ответа:
  - `/pdf`: `application/pdf`, attachment `out.pdf`
  - `/image`: `image/png|image/jpeg`, attachment `out.<type>`

## Что меняется

- Веб-фреймворк: `koa` -> `hono`.
- Валидация: `joi`/`koa-validate` -> `zod` (`@hono/zod-openapi`).
- Документация API:
  - `GET /openapi.json`
  - `GET /docs` (Swagger UI)
- Устойчивость к OOM:
  - пул браузеров,
  - лимит конкуренции,
  - рециклинг браузера после заданного числа рендеров,
  - таймаут рендера.

## Рекомендуемый план перехода

1. Подними `server-next` в staging с теми же входными нагрузками.
2. Сверь интеграции клиента с `/openapi.json` и smoke-тестами.
3. Настрой переменные окружения:
   - `BROWSER_POOL_SIZE`
   - `BROWSER_MAX_PAGES_PER_INSTANCE`
   - `NAVIGATION_TIMEOUT_MS`
   - `RENDER_TIMEOUT_MS`
4. Прогони нагрузочный тест и сравни:
   - latency p95/p99,
   - memory RSS,
   - количество OOM/рестартов.
5. Сделай canary rollout (например 5% -> 25% -> 100%).
6. После стабилизации переведи production-трафик целиком на `server-next`.

## Параметры для анти-OOM тюнинга

- `BROWSER_POOL_SIZE`:
  - меньше значение -> ниже memory footprint, но ниже throughput;
  - больше значение -> выше throughput, но выше риск memory pressure.
- `BROWSER_MAX_PAGES_PER_INSTANCE`:
  - меньше значение -> чаще рециклинг, стабильнее долгоживущий процесс;
  - больше значение -> меньше перезапусков браузера, но выше риск накопления утечек.
- `RENDER_TIMEOUT_MS`:
  - защищает воркеры от зависших задач рендера.

## Проверка миграции

- `npm test` в `server-next`:
  - smoke/integration сценарии для `/pdf` и `/image`,
  - проверка валидации 400 при пустом body.
