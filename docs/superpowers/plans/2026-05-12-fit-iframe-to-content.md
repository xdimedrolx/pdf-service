# fitIframeToContent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `fitIframeToContent` option to the `POST /pdf` request that resizes a same-origin iframe to its scroll height so Chromium paginates over the full iframe content instead of clipping it to one page.

**Architecture:** A new branch is added to `applyPdfWaitOptions` in `server/src/browser/render.js`, executed between the existing `waitIframeLoading` and `waitForTimeout` steps. The branch runs `page.evaluate` with the selector; the in-page closure self-awaits iframe `load`, reads `contentDocument.body.scrollHeight`, and sets `iframe.style.height`. The PDF Zod schema gains an optional string field; image rendering is untouched.

**Tech Stack:** Hono + `@hono/zod-openapi`, Puppeteer, `node:test`, real Chromium for E2E. All commands run from `server/` unless stated otherwise.

**Spec reference:** [docs/superpowers/specs/2026-05-12-fit-iframe-to-content-design.md](../specs/2026-05-12-fit-iframe-to-content-design.md)

---

## Task 1: Implement `fitIframeToContent` in `applyPdfWaitOptions` with unit tests

**Files:**
- Modify: `server/src/browser/render.js` — add the new branch.
- Modify: `server/test/render.test.js` — enhance the fake `page.evaluate` to optionally execute closures, then add three tests.

### Why the test fake needs an upgrade

The existing fake `page.evaluate(fn, arg)` only records the call. To verify the in-page closure's behavior (height set, silent on missing/cross-origin) we need the fake to actually execute the closure with a stub `document`. The change is backward-compatible: if a test does not pass a `documentStub`, the closure is **not** executed and behavior matches the existing fake.

### Steps

- [ ] **Step 1: Enhance `createPage` in `server/test/render.test.js` to optionally execute closures**

Modify the existing `createPage` factory:

```js
const createPage = ({ failOnWaitForSelector = false, documentStub = null } = {}) => {
  const calls = [];

  return {
    calls,
    async emulateMediaType(type) {
      calls.push({ method: 'emulateMediaType', value: type });
    },
    async waitForSelector(selector, options) {
      calls.push({ method: 'waitForSelector', value: { selector, options } });
      if (failOnWaitForSelector) {
        const error = new Error(`Waiting for selector \`${selector}\` failed`);
        error.name = 'TimeoutError';
        throw error;
      }
    },
    async evaluate(fn, ...args) {
      calls.push({ method: 'evaluate', value: args[0] });

      if (!documentStub) {
        return;
      }

      const previousDocument = globalThis.document;
      globalThis.document = documentStub;
      try {
        return await fn(...args);
      } finally {
        if (previousDocument === undefined) {
          delete globalThis.document;
        } else {
          globalThis.document = previousDocument;
        }
      }
    },
    async setExtraHTTPHeaders(headers) {
      calls.push({ method: 'setExtraHTTPHeaders', value: headers });
    },
    setDefaultNavigationTimeout(timeoutMs) {
      calls.push({ method: 'setDefaultNavigationTimeout', value: timeoutMs });
    },
    async goto(url, options) {
      calls.push({ method: 'goto', value: { url, options } });
    },
    async setContent(html, options) {
      calls.push({ method: 'setContent', value: { html, options } });
    },
  };
};
```

- [ ] **Step 2: Run the existing unit tests to confirm the refactor is backward-compatible**

Run: `npm test`
Expected: `pass 30, fail 0`. Existing tests do not pass a `documentStub`, so the closure-execution branch is skipped for them.

- [ ] **Step 3: Add the happy-path test for `fitIframeToContent` to `server/test/render.test.js`**

Append to the file:

```js
test('applyPdfWaitOptions: fitIframeToContent resizes iframe to its scrollHeight', async () => {
  const iframe = {
    contentDocument: {
      readyState: 'complete',
      body: { scrollHeight: 1234 },
    },
    style: {},
  };
  const documentStub = {
    querySelector: (selector) => (selector === '#chart' ? iframe : null),
  };
  const page = createPage({ documentStub });

  await applyPdfWaitOptions(page, { fitIframeToContent: '#chart' });

  const evaluateCall = page.calls.find((call) => call.method === 'evaluate');
  assert.equal(evaluateCall?.value, '#chart');
  assert.equal(iframe.style.height, '1234px');
});
```

- [ ] **Step 4: Run the new test and confirm it fails**

Run: `node --test --test-name-pattern "fitIframeToContent resizes" test/render.test.js`
Expected: FAIL. The selector is never passed to `evaluate` because `applyPdfWaitOptions` does not handle `fitIframeToContent` yet, so `evaluateCall` is `undefined` and the first assertion fails.

- [ ] **Step 5: Implement the new branch in `server/src/browser/render.js`**

Insert this block in `applyPdfWaitOptions`, **after** the `waitIframeLoading` branch and **before** the `waitForTimeout` branch:

```js
  if (options.fitIframeToContent) {
    await page.evaluate(async (selector) => {
      const iframe = document.querySelector(selector);
      if (!iframe || !iframe.contentDocument) {
        return;
      }

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

- [ ] **Step 6: Run the happy-path test and confirm it passes**

Run: `node --test --test-name-pattern "fitIframeToContent resizes" test/render.test.js`
Expected: PASS.

- [ ] **Step 7: Add the two "silent no-op" tests to `server/test/render.test.js`**

Append:

```js
test('applyPdfWaitOptions: fitIframeToContent is silent when the iframe is missing', async () => {
  const documentStub = { querySelector: () => null };
  const page = createPage({ documentStub });

  await applyPdfWaitOptions(page, { fitIframeToContent: '#missing' });

  const evaluateCall = page.calls.find((call) => call.method === 'evaluate');
  assert.equal(evaluateCall?.value, '#missing');
});

test('applyPdfWaitOptions: fitIframeToContent is silent when the iframe is cross-origin', async () => {
  const iframe = { contentDocument: null, style: {} };
  const documentStub = {
    querySelector: () => iframe,
  };
  const page = createPage({ documentStub });

  await applyPdfWaitOptions(page, { fitIframeToContent: '#cross-origin' });

  assert.equal(iframe.style.height, undefined);
});
```

The first asserts the selector still reaches `evaluate` (the closure runs and silently returns). The second asserts the cross-origin guard prevents the height assignment.

- [ ] **Step 8: Run the whole unit suite and confirm everything is green**

Run: `npm test`
Expected: `pass 33, fail 0` (30 prior + 3 new).

- [ ] **Step 9: Commit**

```bash
git add server/src/browser/render.js server/test/render.test.js
git commit -m "$(cat <<'EOF'
feat(render): add fitIframeToContent option for tall iframes

The new applyPdfWaitOptions branch resizes a same-origin iframe to
its body.scrollHeight so Chromium paginates over the full iframe
content instead of clipping it to a single PDF page. The fake
page.evaluate in the unit suite gets a documentStub passthrough so
the in-page closure can be exercised in unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Expose `fitIframeToContent` on the PDF schema

**Files:**
- Modify: `server/src/validation/schemas.js` — add the field to `pdfOptionsSchema`.
- Modify: `server/test/generator.integration.test.js` — enhance the fake `page.evaluate` and add two tests.

### Steps

- [ ] **Step 1: Enhance the fake `page.evaluate` in `server/test/generator.integration.test.js` to record its argument**

Find the `createFakeBrowserPool` factory and replace its `evaluate` method:

```js
    async evaluate(fn, ...args) {
      calls.push({ method: 'evaluate', value: args[0] });
    },
```

(Was: `async evaluate() { calls.push({ method: 'evaluate' }); }`.)

- [ ] **Step 2: Run the integration suite to confirm the existing tests still pass**

Run: `node --test test/generator.integration.test.js`
Expected: `pass 13, fail 0`.

- [ ] **Step 3: Add the positive integration test**

Append to `server/test/generator.integration.test.js`:

```js
test('POST /pdf with fitIframeToContent passes the selector to page.evaluate', async () => {
  const { app, browserPool } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<html><body><iframe id="chart"></iframe></body></html>',
      options: { fitIframeToContent: '#chart' },
    }),
  });

  assert.equal(response.status, 200);

  const evaluateCall = browserPool.calls.find((call) => call.method === 'evaluate');
  assert.equal(evaluateCall?.value, '#chart');
});
```

- [ ] **Step 4: Add the strict-schema rejection test**

Append:

```js
test('POST /pdf returns 400 when fitIframeToContent is not a string', async () => {
  const { app } = createTestApp();

  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html: '<html></html>',
      options: { fitIframeToContent: 123 },
    }),
  });

  assert.equal(response.status, 400);
});
```

- [ ] **Step 5: Run both new tests and confirm they fail**

Run: `node --test --test-name-pattern "fitIframeToContent" test/generator.integration.test.js`
Expected: FAIL. The first test fails because the schema rejects the unknown option (strict mode) and returns 400 instead of 200. The second test fails because the schema does not yet validate the field's type — passing `123` is rejected as unknown, but the failure mode and assertion both happen to be 400, so this test may incidentally pass. That is acceptable; both will pass cleanly after Step 6.

- [ ] **Step 6: Add `fitIframeToContent` to `pdfOptionsSchema` in `server/src/validation/schemas.js`**

In `pdfOptionsSchema`, insert the new field alongside the other optional fields (location is not load-bearing; keep it near `waitIframeLoading` for readability):

```js
  fitIframeToContent: z.string().optional().openapi({
    description:
      'CSS selector for an iframe to resize. The matched iframe height is set to its scrollHeight so the parent document grows to accommodate the full content. Same-origin iframes only; missing or cross-origin selectors are silently ignored.',
  }),
```

- [ ] **Step 7: Run the integration suite and confirm all tests pass**

Run: `node --test test/generator.integration.test.js`
Expected: `pass 15, fail 0` (13 prior + 2 new).

- [ ] **Step 8: Run the full unit suite as a sanity check**

Run: `npm test`
Expected: `pass 35, fail 0`.

- [ ] **Step 9: Commit**

```bash
git add server/src/validation/schemas.js server/test/generator.integration.test.js
git commit -m "$(cat <<'EOF'
feat(schema): accept fitIframeToContent on POST /pdf options

Adds the optional string field to pdfOptionsSchema with an OpenAPI
description and enhances the integration test fake to capture
page.evaluate arguments. Strict-mode rejection of non-string values
is covered too.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: End-to-end coverage with real Chromium

**Files:**
- Modify: `server/test/e2e/generator.e2e.test.js` — add two static-server routes, a `countPdfPages` helper, and two tests.

### Steps

- [ ] **Step 1: Add two new routes to the static `http.createServer` inside the `before(...)` block in `server/test/e2e/generator.e2e.test.js`**

Locate the existing `if (req.url === '/with-selector') { ... }` block and append the two new branches before the `res.statusCode = 404` fallback:

```js
    if (req.url === '/with-iframe') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        '<!DOCTYPE html><html><body style="margin:0;">'
        + '<iframe id="frame" src="/tall" style="width:100%;height:400px;border:0;"></iframe>'
        + '</body></html>'
      );
      return;
    }

    if (req.url === '/tall') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      let html = '<!DOCTYPE html><html><body style="margin:0;">';
      for (let i = 0; i < 30; i += 1) {
        html += `<p style="height:100px;margin:0;background:#eee;">Block ${i}</p>`;
      }
      html += '</body></html>';
      res.end(html);
      return;
    }
```

The 30 × 100px blocks give a ~3000px tall iframe document — enough to span multiple A4 pages when expanded.

- [ ] **Step 2: Add the `countPdfPages` helper near the top of `server/test/e2e/generator.e2e.test.js` (after the magic-byte constants)**

```js
const countPdfPages = (buffer) => {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 0;
};
```

The negative lookahead `(?!s)` excludes the single `/Type /Pages` page-tree node so only leaf page objects are counted.

- [ ] **Step 3: Add the control test (tall iframe, no resize → 1 page)**

Append to `server/test/e2e/generator.e2e.test.js`:

```js
test('POST /pdf control: tall iframe without fitIframeToContent produces a single-page PDF', async () => {
  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${staticServerUrl}/with-iframe`,
      options: { waitIframeLoading: '#frame', format: 'A4' },
    }),
  });

  assert.equal(response.status, 200);

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 4).toString('utf8'), PDF_MAGIC);
  assert.equal(countPdfPages(buffer), 1);
});
```

- [ ] **Step 4: Add the resize test (with fitIframeToContent → ≥ 2 pages)**

Append:

```js
test('POST /pdf with fitIframeToContent paginates over the full iframe content', async () => {
  const response = await app.request('/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `${staticServerUrl}/with-iframe`,
      options: { fitIframeToContent: '#frame', format: 'A4' },
    }),
  });

  assert.equal(response.status, 200);

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 4).toString('utf8'), PDF_MAGIC);
  const pageCount = countPdfPages(buffer);
  assert.ok(pageCount >= 2, `expected >= 2 pages, got ${pageCount}`);
});
```

- [ ] **Step 5: Run the e2e suite**

Run: `npm run test:e2e`
Expected: `pass 10, fail 0` (8 prior + 2 new). Each new test takes roughly 1–2 seconds with the warm browser pool.

- [ ] **Step 6: Commit**

```bash
git add server/test/e2e/generator.e2e.test.js
git commit -m "$(cat <<'EOF'
test(e2e): cover fitIframeToContent with a tall real iframe

Adds two static-server routes (/with-iframe and /tall) that serve a
~3000px iframe document inside a 400px frame. A control test asserts
the baseline (1 PDF page when the iframe is left at its fixed size);
the second test asserts the resize option produces at least 2 pages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Document the new option

**Files:**
- Modify: `README.md` — add `fitIframeToContent` to the PDF options list.

### Steps

- [ ] **Step 1: Update the `POST /pdf` options list in `README.md`**

Find the line beginning with `\`path\`, \`scale\`, ...` under the heading `### \`POST /pdf\` options` and insert `\`fitIframeToContent\`` after `\`waitIframeLoading\``. The resulting line should read:

```markdown
`path`, `scale`, `displayHeaderFooter`, `headerTemplate`, `footerTemplate`, `printBackground`, `landscape`, `pageRanges`, `format`, `width`, `height`, `waitForSelector`, `waitForSelectorTimeoutMs` (default `30000`), `waitIframeLoading`, `fitIframeToContent`, `waitForTimeout`, `waitUntil`, `emulateMediaType`, `margin`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: list fitIframeToContent in README POST /pdf options

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification (post-implementation)

After all four tasks are committed:

- [ ] `npm test` → 35 unit tests pass.
- [ ] `npm run test:e2e` → 10 e2e tests pass.
- [ ] `git log --oneline -4` shows the four commits in order:
  - `docs: list fitIframeToContent in README POST /pdf options`
  - `test(e2e): cover fitIframeToContent with a tall real iframe`
  - `feat(schema): accept fitIframeToContent on POST /pdf options`
  - `feat(render): add fitIframeToContent option for tall iframes`
