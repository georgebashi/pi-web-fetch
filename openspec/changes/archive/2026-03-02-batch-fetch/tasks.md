## 1. Parameter Schema

- [x] 1.1 Add `pages` array type to the tool parameters schema using TypeBox (`Type.Optional(Type.Array(Type.Object({ url: Type.String(), prompt: Type.Optional(Type.String()) }), { maxItems: 10 }))`)
- [x] 1.2 Update the tool description to document batch usage with `pages` and recommend it for multi-page fetches
- [x] 1.3 Add parameter validation at the start of `execute`: mutual exclusivity check (`url` vs `pages`), empty array check, batch size limit (max 10)

## 2. Batch Dispatch Logic

- [x] 2.1 Extract the existing single-URL pipeline in `execute` into a reusable `processSingleUrl` function that takes `(url, prompt, model, thinkingLevel, signal, onUpdate)` and returns a tool result
- [x] 2.2 Add batch code path in `execute`: when `pages` is provided, call `processSingleUrl` for each entry via `Promise.allSettled`, collecting results
- [x] 2.3 Emit progress updates during batch processing — initial "Fetching N pages..." and incremental "Fetching N pages... (M/N done)" as each page completes

## 3. Batch Result Formatting

- [x] 3.1 Implement batch result formatter: combine per-page results into a single text content block with `--- [N/total] url ---` headers, preserving original request order
- [x] 3.2 Handle per-page errors inline — include the error message in the page's section rather than failing the whole batch

## 4. Render Updates

- [x] 4.1 Update `renderCall` to show batch information (e.g., "web_fetch 3 pages" or list first few URLs) when `pages` is provided
- [x] 4.2 Update `renderResult` to handle batch output format (collapsed preview shows first few lines across pages)

## 5. Tests

- [x] 5.1 Add unit tests for parameter validation: mutual exclusivity, empty array, batch size limit, valid single-url unchanged
- [x] 5.2 Add unit tests for batch result formatting: all succeed, mixed success/failure, result ordering
- [x] 5.3 Add integration-style test verifying batch dispatch processes pages concurrently and returns labeled results
