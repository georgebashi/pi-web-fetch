## Why

Agents frequently need to fetch multiple web pages in parallel (e.g., researching a topic across several sources). Today `web_fetch` accepts a single URL+prompt pair, so the agent must issue N separate tool calls — one per URL. Each tool call adds round-trip latency through the agent loop. Allowing the tool to accept an array of URL+prompt pairs in a single call lets the extension fetch and process all pages concurrently, cutting wall-clock time dramatically and reducing agent loop overhead.

## What Changes

- The `web_fetch` tool parameter schema changes from a single `url`/`prompt` pair to accept **either** the existing single-URL form **or** a new `pages` array of `{ url, prompt? }` objects.
- When `pages` is provided, the extension fetches all URLs concurrently (bounded by the existing browser pool's `maxTabs` limit) and returns results for each page as separate content blocks.
- The existing single-URL parameters (`url`, `prompt`) continue to work exactly as before — full backward compatibility.
- Error handling is per-page: a failure fetching one URL does not abort the others.

## Capabilities

### New Capabilities
- `batch-fetch`: Accepting an array of URL+prompt pairs in a single `web_fetch` tool call, fetching them concurrently through the browser pool, and returning per-page results.

### Modified Capabilities
- `web-fetch`: The tool's parameter schema expands to accept the `pages` array alongside the existing `url`/`prompt` parameters. The tool description updates to document the batch usage pattern.

## Impact

- **Tool schema**: `web_fetch` parameters change (additive — existing calls are unaffected).
- **Tool description**: Updated to document the batch pattern and guide agents toward it for multi-page use cases.
- **index.ts**: Execute function gains batch dispatch logic; reuses existing `runFetch`, `runExtract`, `runProcess` pipeline per page.
- **Browser pool**: No changes needed — already supports concurrent tab acquisition up to `maxTabs`.
- **Extensions/hooks**: Each page in a batch goes through the full extension hook pipeline independently.
- **Dependencies**: No new dependencies.
