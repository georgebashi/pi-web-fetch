## Context

The `web_fetch` tool currently accepts a single `url` + optional `prompt`. When agents need to research across multiple pages, they issue parallel tool calls — each going through the agent loop independently. The browser pool already supports concurrent tab usage (up to 6 tabs), but this concurrency is underutilized since each tool invocation processes exactly one URL.

The extension already has all infrastructure for concurrent fetching (browser pool, cache, abort signal propagation). The change is primarily at the parameter schema and dispatch layer.

## Goals / Non-Goals

**Goals:**
- Allow a single `web_fetch` call to process multiple URLs concurrently
- Maintain full backward compatibility with existing single-URL calls
- Reuse the existing per-page pipeline (fetch → extract → hooks → process) unchanged
- Provide clear per-page results so the agent can distinguish successes from failures

**Non-Goals:**
- Changing the browser pool implementation or concurrency limits
- Adding cross-page processing (e.g., "compare these pages")
- Modifying the extension hook system — each page in a batch goes through hooks independently
- Changing the cache semantics — batch items use the same cache as single-URL fetches

## Decisions

### 1. Parameter schema: `pages` array alongside existing `url`/`prompt`

**Decision**: Add an optional `pages` parameter (array of `{ url, prompt? }` objects) to the existing schema. The caller provides **either** `url` (+ optional `prompt`) for single-page mode **or** `pages` for batch mode. If both are provided, return a validation error.

**Rationale**: This is additive and fully backward compatible. Existing tool calls with `url`/`prompt` work identically. The array form is a natural extension that agents can discover from the updated tool description.

**Alternative considered**: Replacing `url`/`prompt` with `pages` that defaults to a single-element array. Rejected because it breaks backward compatibility and makes single-page calls more verbose.

### 2. Concurrency via Promise.allSettled

**Decision**: Process all pages in the batch concurrently using `Promise.allSettled`. Each page runs through the full pipeline independently (cache check → beforeFetch hook → fetch → afterFetch hook → extract → afterExtract hook → cache store → process). The browser pool's existing `maxTabs` limit naturally bounds concurrency.

**Rationale**: `Promise.allSettled` ensures that a failure in one page doesn't abort others. The browser pool's queue (`waitForSlot`) already handles backpressure gracefully — if 10 URLs are requested but only 6 tabs are available, 4 will queue and proceed as tabs free up.

**Alternative considered**: Processing pages sequentially. Rejected as it defeats the purpose of the optimization.

### 3. Result format: labeled content blocks

**Decision**: For batch calls, return one text content block per page. Each block is prefixed with a header line identifying the URL, followed by the page's result (content, summary, or error). This keeps results in a single flat `content` array that the agent can parse naturally.

**Format**:
```
--- [1/3] https://example.com/page1 ---
<page content or error>

--- [2/3] https://example.com/page2 ---
<page content or error>

--- [3/3] https://example.com/page3 ---
<page content or error>
```

**Rationale**: A single text content block with clear delimiters is the simplest approach for both the implementation and the consuming agent. Using separate content array entries was considered but agents handle a single labeled text more reliably.

**Alternative considered**: Returning separate content blocks per page (one array entry each). This works but makes it harder for agents to correlate results with URLs when some entries are errors.

### 4. Progress updates during batch processing

**Decision**: Emit `onUpdate` progress for each page as it completes, showing a running count (e.g., "Fetching 3 pages... (1/3 done)").

**Rationale**: Gives the user visibility into batch progress, especially for large batches where some pages may be slow.

### 5. Batch size limit

**Decision**: Cap the `pages` array at 10 entries. Return a validation error if more are provided.

**Rationale**: Prevents accidental abuse (e.g., agent passing 100 URLs). The browser pool only has 6 tabs, so large batches would queue heavily. 10 is generous for typical multi-page research while keeping resource usage reasonable.

## Risks / Trade-offs

- **[Risk] Sub-agent concurrency** — Running multiple sub-agent LLM calls concurrently (when pages have prompts) may hit rate limits or consume significant API credits. → Mitigation: The browser pool's tab limit (6) naturally caps concurrency, and sub-agent calls only run after fetch+extract completes. In practice this is bounded.

- **[Risk] Large batch results overflow context** — 10 pages × large content could produce very large tool results. → Mitigation: Each page independently goes through the existing size threshold / summarization logic. Prompted pages get LLM-distilled answers. Unprompted large pages get summaries.

- **[Trade-off] Single text block vs structured array** — Using a single text block with delimiters is simpler but less structured than returning a JSON-like array. The trade-off favors simplicity since agents parse natural language well and the delimiter format is unambiguous.
