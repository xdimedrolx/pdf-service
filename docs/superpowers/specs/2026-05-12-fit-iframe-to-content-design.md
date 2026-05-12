# Fit iframe to content — design

**Status:** approved for implementation
**Date:** 2026-05-12
**Scope:** PDF generation only (`POST /pdf`)

## Problem

When a page embeds an iframe whose internal document is taller than the iframe's CSS height, Puppeteer's `page.pdf()` only renders what is visible inside the iframe viewport. Tall iframe content is clipped to a single PDF page. There is currently no option to make Chromium paginate over the full iframe content.

## Solution

Add a new optional field on the PDF options schema. Its value is a CSS selector. When set, the render path resizes the matched iframe so that its CSS height equals the natural height of its inner document (`contentDocument.body.scrollHeight`). The iframe element stays in the DOM; the parent document grows; Chromium's pdf engine paginates naturally across the full content.

## Contract

### Schema

`server/src/validation/schemas.js`, inside `pdfOptionsSchema`:

```js
fitIframeToContent: z.string().optional()
```

`generateImageSchema` is **not** changed. This option is PDF-only for now. The same need on image rendering is left as straightforward future work and is explicitly out of scope.

### Field semantics

- Value: any valid CSS selector accepted by `document.querySelector`.
- Targets **the first match** of `querySelector(selector)`. Multiple iframes on a page are out of scope; if the user needs them, they wrap or pick a more specific selector.
- If the selector matches nothing, or the matched iframe is cross-origin (`contentDocument === null`), the step is a **silent no-op**. No error is thrown, no 4xx returned. This matches the existing `waitIframeLoading` behavior.
- The option is independent of `waitIframeLoading`. Setting `fitIframeToContent` alone is sufficient — the resize step internally awaits iframe `load` before measuring.

### OpenAPI surface

`fitIframeToContent` becomes a documented field of the `/pdf` request `options` object. Description should call out:
- "Resizes the matched iframe so its CSS height equals its scroll height."
- "Same-origin iframes only. Cross-origin and missing selectors are silently ignored."

## Behavior

The new step lives in `applyPdfWaitOptions` in `server/src/browser/render.js`. Order of steps after the change:

1. `emulateMediaType`
2. `waitForSelector`
3. `waitIframeLoading`
4. **`fitIframeToContent`** ← new
5. `waitForTimeout`

Implementation sketch:

```js
if (options.fitIframeToContent) {
  await page.evaluate(async (selector) => {
    const iframe = document.querySelector(selector);
    if (!iframe || !iframe.contentDocument) return;

    if (iframe.contentDocument.readyState !== 'complete') {
      await new Promise((resolve) => {
        iframe.addEventListener('load', () => resolve(), { once: true });
      });
    }

    const contentHeight = iframe.contentDocument.body.scrollHeight;
    iframe.style.height = `${contentHeight}px`;
  }, options.fitIframeToContent);
}
```

Width is not modified. Only `iframe.style.height` is set. The iframe's own CSS, fonts, and `break-before`/`break-after` rules inside its document continue to work and apply during pagination.

### Interaction with other options

- **`waitIframeLoading`**: redundant when `fitIframeToContent` targets the same iframe (the resize step internally waits for `load`). Still useful on its own when the user wants the wait without the resize. Both can be set; the resize will short-circuit the second wait because `readyState === 'complete'`.
- **`waitForTimeout`**: runs **after** the resize, so any post-resize layout settling (lazy images inside the iframe, web fonts) can complete before the snapshot.
- **`waitForSelector`**: applies to the parent document, not the iframe. Unchanged.

## Error handling

No new error code. The step is a silent no-op on missing selector or cross-origin iframe, identical to `waitIframeLoading`. Rationale: same expectation as the existing wait helper — fail-soft, not fail-hard, because a missing iframe is usually a content authoring issue and should not cascade into a 5xx.

If `page.evaluate` itself throws for an unexpected reason (Puppeteer-level failure), the existing error pipeline catches it: it bubbles to `app.onError`, which logs and returns a 500 with `code: INTERNAL_ERROR` and a correlation id. No new pathway needed.

## Testing

### Unit tests — `server/test/render.test.js`

Three new tests, using the existing fake `page` factory pattern:

1. **`fitIframeToContent: '#frame'` triggers `page.evaluate` with the selector.** Assert `evaluate` was called with `'#frame'` as the argument. Mirrors the existing `waitIframeLoading` test.
2. **Missing iframe is a silent no-op.** The fake `page.evaluate` runs the closure against a fake DOM where `querySelector` returns `null`. Assert no throw and no thrown error from `applyPdfWaitOptions`.
3. **Cross-origin iframe (`contentDocument === null`) is a silent no-op.** Same shape as #2 but with `contentDocument` explicitly null on the fake iframe.

### E2E tests — `server/test/e2e/generator.e2e.test.js`

Extend the local HTTP server in `before(...)` with two new routes:

- `/with-iframe` — returns a parent document containing `<iframe id="frame" src="/tall"></iframe>` with a fixed CSS height (e.g. 400px).
- `/tall` — returns a tall document, ~3000px body height. Concrete content can be a column of `<p>` blocks; the test only inspects PDF page count.

Two new test cases:

1. **Control: tall iframe without `fitIframeToContent` produces a single-page PDF.** This is the baseline that demonstrates the bug-fix value.
2. **`fitIframeToContent: '#frame'` produces a multi-page PDF.** Assert at least 2 pages.

Page-count check: scan the PDF buffer for occurrences of `/Type /Page` (with the trailing space, to exclude `/Type /Pages`). It is not the most precise PDF inspection in the world, but it is dependency-free and reliably distinguishes "1 page" from "multiple pages" for our shape of output. The control test asserts it sees exactly 1; the resize test asserts it sees ≥ 2.

### What is not tested

- Multiple iframes — explicitly out of scope. Selector matches the first.
- Cross-origin iframes — covered by unit tests; an e2e cross-origin setup adds CORS plumbing without proportional value.
- Concurrent requests — already covered by the existing concurrency e2e test, which exercises the pool.

## Documentation

- README.md `POST /pdf options` list: add `fitIframeToContent` to the inline list of supported option names.
- CLAUDE.md: not touched. The architectural sections already describe how options flow through `applyPdfWaitOptions`.
- OpenAPI: handled automatically by `@hono/zod-openapi` from the schema change. Description can be added via `.openapi({ description: '...' })` on the field if we want it to appear in `/docs`.

## Out of scope

- Image (screenshot) support.
- Multiple iframes per page.
- Cross-origin iframe content extraction.
- Replacing the iframe with its inner HTML (Approach B from brainstorming — explicitly rejected in favor of resize).
- Width adjustments.
- Resize debouncing or repeated measurement after dynamic content changes.
