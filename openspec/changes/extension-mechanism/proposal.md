## Why

pi-web-fetch currently treats every URL the same: fetch via headless Chrome, extract via trafilatura, optionally summarize with a sub-agent. This one-size-fits-all approach fails for many real-world scenarios. GitHub code URLs get fetched as rendered HTML when the agent should be cloning the repo and using the scout. Google Docs URLs get scraped instead of using the google_workspace_mcp tools. Corporate proxies mangle URLs in ways the fetcher can't handle. Some sites need authentication, special extraction settings, or entirely custom fetch logic. There's no way to customize any of this without forking the extension.

An extension/hook system would let site-specific behavior be plugged in — including the critical ability to **reject a fetch entirely** and redirect the agent to a better tool — turning pi-web-fetch into a URL routing layer, not just a fetcher.

## What Changes

- Add a hook-based extension mechanism with lifecycle hooks: `beforeFetch`, `afterFetch`, `afterExtract`, and `summarize`
- Add domain/URL pattern matching to route URLs to the appropriate extension
- The `beforeFetch` hook can **short-circuit** the entire fetch pipeline and return an alternative instruction or error to the agent (the "reject/redirect" pattern)
- Extensions are loaded from three sources: built-in (bundled with package), local (from a configurable directory), and Pi extensions (separate npm packages that register via Pi's shared event bus)
- Each extension is a module exporting hook functions and a URL matcher (same `WebFetchExtension` interface for all sources)
- Pi extension registration uses a two-way handshake via `web-fetch:register` and `web-fetch:ready` events to handle arbitrary load order
- Add built-in "redirect" extensions for common cases (GitHub code URLs → clone+scout, Google Docs → MCP tools)
- Support URL rewriting in `beforeFetch` (e.g., GitHub blob URLs → raw.githubusercontent.com)
- Support per-site trafilatura option overrides in `afterFetch`/`afterExtract` hooks
- Support post-processing chains in `afterExtract` (content cleanup, metadata injection)

## Capabilities

### New Capabilities
- `extension-hooks`: Core hook lifecycle system — defines the hook points (`beforeFetch`, `afterFetch`, `afterExtract`, `summarize`), execution order, short-circuit semantics, and the extension interface contract
- `extension-loading`: Discovery, loading, and registration of extensions from three sources: built-in (bundled), local (user directory), and Pi extensions (separate npm packages that register via Pi's shared event bus), including URL/domain matching rules and load-order-independent handshake protocol
- `fetch-redirect`: The "reject/redirect" pattern — extensions that refuse to fetch a URL and return actionable instructions telling the agent to use a better approach (e.g., clone repo, use MCP tools)

### Modified Capabilities
- `web-fetch`: The existing fetch pipeline must be refactored to invoke hooks at each lifecycle point, passing control to matched extensions before falling through to default behavior

## Impact

- **index.ts**: Major refactor — the fetch pipeline needs to be broken into hook-invocable stages instead of a monolithic function
- **New files**: Extension types, loader, hook runner, built-in extensions (github-redirect, google-docs-redirect, etc.)
- **Configuration**: New config surface in `~/.pi/agent/web-fetch.json` for local extension directory and per-extension settings
- **API surface**: `WebFetchExtension`, `HookContext`, and `HookResult` types exported from package — this becomes a public contract for Pi extension authors
- **Event bus protocol**: `web-fetch:register` and `web-fetch:ready` channels on Pi's shared event bus — enables separate Pi extensions (e.g., `pi-web-fetch-youtube`) to register site handlers
- **Dependencies**: `picomatch` for URL pattern matching
- **Backwards compatibility**: Existing behavior must be preserved as the default when no extension matches a URL — the hook system wraps the current pipeline, it doesn't replace it
