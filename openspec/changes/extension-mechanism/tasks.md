## 1. Extension Interface & Types

- [x] 1.1 Create `types.ts` with `WebFetchExtension`, `HookContext`, `HookResult` interfaces and the `redirect()` helper
- [x] 1.2 Export types from the package entry point so Pi extension authors can `import type { WebFetchExtension } from "pi-web-fetch"`

## 2. URL Pattern Matching

- [x] 2.1 Add `picomatch` as a dependency (and `@types/picomatch` as dev dependency)
- [x] 2.2 Implement `matchExtension(url: string, extensions: WebFetchExtension[]): WebFetchExtension | null` — extracts hostname+pathname from URL and matches against extension glob patterns, returning the first match

## 3. Extension Registry

- [x] 3.1 Implement the extension registry: a data structure holding three ordered lists (event-bus, local, built-in) with a `match(url)` method that searches in priority order
- [x] 3.2 Implement built-in extension loader: scan the `extensions/` directory relative to package root and dynamically import each module
- [x] 3.3 Implement local extension loader: scan `~/.pi/extensions/web-fetch/` (or configured `extensionsDir`) and dynamically import each `.ts`/`.js` file, with try/catch per module and warning on failure
- [x] 3.4 Implement event bus registration: subscribe to `web-fetch:register` channel, validate incoming payloads (require `name` and `matches`), add valid extensions to the event-bus list
- [x] 3.5 Implement `web-fetch:ready` signal: emit after subscribing to `web-fetch:register` and loading built-in + local extensions
- [x] 3.6 Keep `web-fetch:register` listener active for the session lifetime (not just during startup)
- [x] 3.7 Wire extension loading into `session_start` event handler, log extension count

## 4. Pipeline Refactoring

- [x] 4.1 Extract the fetch pipeline stages from the monolithic `execute` function into separate named functions: `runFetch`, `runExtract`, `runProcess`
- [x] 4.2 Add `beforeFetch` hook invocation point — after URL validation/cache check, before puppeteer launch. If hook returns `HookResult`, short-circuit and return it
- [x] 4.3 Add `afterFetch` hook invocation point — after puppeteer returns HTML. If hook returns `{ html }`, replace fetched HTML
- [x] 4.4 Add `afterExtract` hook invocation point — after trafilatura extraction. If hook returns a string, replace extracted markdown
- [x] 4.5 Add `summarize` hook invocation point — before sub-agent invocation. If hook returns `HookResult`, skip sub-agent

## 5. Built-in Extensions

- [x] 5.1 Create `extensions/github-redirect.ts` — matches `github.com/*/*/blob/**` and `github.com/*/*/tree/**`, returns redirect message instructing agent to use `gh` CLI or clone+scout
- [x] 5.2 Create `extensions/google-docs-redirect.ts` — matches `docs.google.com/**`, returns redirect message instructing agent to use google_workspace_mcp tools

## 6. Configuration

- [x] 6.1 Extend `WebFetchConfig` interface with `extensionsDir` (optional string) for custom local extension directory path
- [x] 6.2 Read `extensionsDir` from `~/.pi/agent/web-fetch.json` during config loading

## 7. Packaging & Distribution

- [x] 7.1 Add `extensions/` directory and `types.ts` to the `files` array in `package.json` so built-in extensions and types are published
- [x] 7.2 Add `picomatch` dependency and `@types/picomatch` dev dependency to `package.json`
- [x] 7.3 Add an `exports` field to `package.json` exposing the type definitions

## 8. Testing & Validation

- [ ] 8.1 Manual test: fetch a GitHub blob URL and verify the redirect message is returned instead of scraped content
- [ ] 8.2 Manual test: fetch a Google Docs URL and verify the redirect message is returned
- [ ] 8.3 Manual test: fetch a normal URL (e.g., a blog post) and verify default pipeline works unchanged
- [ ] 8.4 Manual test: create a local extension in `~/.pi/extensions/web-fetch/` and verify it loads and matches
- [ ] 8.5 Manual test: create a minimal Pi extension that registers via event bus (`web-fetch:register`) and verify it is picked up regardless of load order
- [ ] 8.6 Manual test: verify Pi extension registered via event bus takes priority over a built-in extension matching the same URL pattern
