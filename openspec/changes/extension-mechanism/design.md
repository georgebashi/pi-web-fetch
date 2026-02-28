## Context

pi-web-fetch is a single-file Pi extension (~667 lines) that registers one tool (`web_fetch`). The current fetch pipeline is a linear sequence: validate URL → check cache → fetch via puppeteer → extract via trafilatura → optionally summarize via sub-agent. All of this lives in `index.ts` with no extension points.

The extension is distributed as an npm package (`pi-web-fetch`) with puppeteer as its only runtime dependency. Configuration lives in `~/.pi/agent/web-fetch.json` (model and thinking level overrides). The codebase has no plugin infrastructure today.

The Pi extension API (`ExtensionAPI`) provides event hooks (`session_start`, `session_shutdown`), tool registration (`registerTool`), subprocess execution (`exec`), UI notifications, and critically, a **shared event bus** (`pi.events`) that all loaded extensions can use for cross-extension communication. Extensions are TypeScript modules loaded by Pi at startup. Pi has no formal dependency/ordering system between extensions — load order is alphabetical within each discovery source (global `~/.pi/agent/extensions/`, project-local `.pi/extensions/`, explicit paths).

## Goals / Non-Goals

**Goals:**
- Define a hook-based extension system that intercepts the fetch pipeline at key lifecycle points
- Enable the "reject/redirect" pattern where an extension can short-circuit a fetch and return instructions to use a different tool
- Ship built-in redirect extensions for GitHub code URLs and Google Docs URLs
- **Support three extension sources:** built-in (bundled), local (files in a directory), and **Pi extensions** (separate npm packages loaded as Pi extensions that register site handlers via the event bus)
- Support URL rewriting before fetch (e.g., GitHub blob → raw.githubusercontent.com)
- Keep the extension interface simple enough that a site-specific handler is ~20-50 lines
- Preserve 100% backward compatibility when no extensions match a URL
- Handle load order gracefully — a `pi-web-fetch-youtube` extension may load before or after `pi-web-fetch`

**Non-Goals:**
- OAuth flows, cookie injection, or complex auth handling — too much scope for v1; can be added as extensions later
- Per-site trafilatura option overrides — trafilatura's CLI interface doesn't cleanly support this; defer to post-processing hooks
- Extension hot-reloading — extensions are loaded once at session start

## Decisions

### 1. Hook-based pipeline with short-circuit semantics

**Decision:** Implement four hook points in the fetch pipeline: `beforeFetch`, `afterFetch`, `afterExtract`, `summarize`. Each hook can return a result that short-circuits the remainder of the pipeline.

**Rationale:** Hooks are the simplest model that covers all use cases. A `beforeFetch` hook returning a result skips fetching entirely (the redirect pattern). An `afterExtract` hook can transform content. The `summarize` hook can replace the default sub-agent summarization. This is simpler than a middleware/chain-of-responsibility pattern because most extensions only care about one hook point.

**Alternatives considered:**
- **Middleware pattern** (Express-style `next()`): More flexible but more complex for extension authors. Most extensions are site-specific and only need one hook.
- **Event emitter pattern**: Too loose — no way to short-circuit or return values.
- **Full pipeline replacement**: Too coarse — extensions would have to reimplement the entire fetch flow.

### 2. URL matching via glob patterns on hostname + pathname

**Decision:** Each extension declares a `matches` field: an array of URL patterns using glob syntax on the hostname + pathname (e.g., `github.com/*/blob/**`, `docs.google.com/**`). Matching uses the `picomatch` library (already common in the Node ecosystem, zero dependencies).

**Rationale:** Glob patterns are familiar to developers, expressive enough for domain + path matching, and simple to implement. Full regex would be more powerful but harder to read and write correctly. The hostname + pathname scope avoids matching on query strings or fragments, which are rarely meaningful for site-specific behavior.

**Alternatives considered:**
- **Regex patterns**: More powerful but error-prone and less readable.
- **Hostname-only matching**: Too coarse — can't distinguish `github.com/org/repo/blob/...` from `github.com/org/repo/issues/...`.
- **Custom DSL**: Unnecessary complexity.

### 3. Extensions as plain TypeScript/JavaScript objects

**Decision:** An extension is a module that exports a default function returning a `WebFetchExtension` object with `name`, `matches`, and optional hook functions. No class inheritance, no decorators. The same `WebFetchExtension` interface is used for all three registration paths (built-in, local file, Pi event bus).

```typescript
interface WebFetchExtension {
  name: string;
  description?: string;
  matches: string[];
  beforeFetch?(ctx: HookContext): Promise<HookResult | void>;
  afterFetch?(ctx: HookContext & { html: string }): Promise<HookResult | void>;
  afterExtract?(ctx: HookContext & { markdown: string }): Promise<HookResult | string | void>;
  summarize?(ctx: HookContext & { markdown: string; prompt?: string }): Promise<HookResult | void>;
}
```

**Rationale:** Plain objects with optional methods are the simplest possible interface. Extension authors only implement the hooks they need. No base class to extend, no registration ceremony. The factory function pattern (default export is a function) allows extensions to accept configuration. Crucially, this same shape works whether the extension is loaded from a file or registered via the event bus — the registration surface is the `WebFetchExtension` object, not the delivery mechanism.

### 4. Three-source extension loading with event bus handshake

**Decision:** Extensions are loaded from three sources:
1. **Built-in extensions** bundled with pi-web-fetch (e.g., `extensions/github-redirect.ts`, `extensions/google-docs-redirect.ts`)
2. **Local extensions** from `~/.pi/extensions/web-fetch/` (configurable via `web-fetch.json`)
3. **Pi extensions** (separate npm packages like `pi-web-fetch-youtube`) that register site handlers via Pi's shared event bus (`pi.events`)

For the event bus integration, pi-web-fetch uses a **two-way handshake** to handle load order:

```
pi-web-fetch                          pi-web-fetch-youtube
===========                           ====================
session_start:
  1. Subscribe to "web-fetch:register"
  2. Load built-in + local extensions
  3. Emit "web-fetch:ready"
                                      On load (factory fn):
                                        1. Listen for "web-fetch:ready" → register
                                        2. Try registering immediately via
                                           "web-fetch:register" (in case web-fetch
                                           loaded first)
```

This handles both load orders:
- **pi-web-fetch loads first**: It subscribes to `web-fetch:register`, then emits `web-fetch:ready`. When pi-web-fetch-youtube loads later, it tries emitting `web-fetch:register` (which pi-web-fetch is already listening for) — registered immediately.
- **pi-web-fetch-youtube loads first**: It listens for `web-fetch:ready` and tries emitting `web-fetch:register` (no listener yet — ignored). When pi-web-fetch loads later, it subscribes to `web-fetch:register`, then emits `web-fetch:ready` — pi-web-fetch-youtube receives this and re-emits its registration.

Priority order: Pi extensions (event bus) → local extensions → built-in extensions. This means a Pi extension can override a built-in redirect.

**Rationale:** The event bus is Pi's existing mechanism for cross-extension communication. Using it avoids inventing a new discovery system. The two-way handshake elegantly solves the load order problem without requiring Pi to add dependency management. The `WebFetchExtension` interface is the same regardless of registration path, keeping things simple.

**Alternatives considered:**
- **Only local file extensions**: Forces users to maintain loose files instead of installable packages. No composability.
- **Pi tool_call/tool_result interception**: Other extensions could intercept `web_fetch` calls via Pi's `tool_call` event, but this is a blunt instrument — they'd have to parse URL patterns themselves and can't participate in the pipeline stages.
- **npm packages as self-loading extensions**: Would require each package to independently register Pi tools, duplicating the pipeline. The event bus approach lets them plug into pi-web-fetch's pipeline instead.

### 5. HookContext provides URL, signal, and a redirect helper

**Decision:** The `HookContext` passed to every hook includes:

```typescript
interface HookContext {
  url: string;              // normalized URL
  parsedUrl: URL;           // parsed URL object
  prompt?: string;          // user's prompt (if provided)
  signal?: AbortSignal;     // abort signal
  redirect(message: string): HookResult;  // helper to short-circuit with instructions
}
```

The `redirect()` helper creates a properly formatted rejection message. `HookResult` is `{ content: ToolContent[]; isError?: boolean }` — the same shape as the tool's return type.

**Rationale:** The redirect helper standardizes the rejection pattern so every redirect extension produces consistent, actionable messages. Raw `HookResult` return is still available for extensions that need full control.

### 6. Built-in redirect extensions for GitHub and Google Docs

**Decision:** Ship two built-in extensions:
- **github-redirect**: Matches `github.com/*/*/blob/**` and `github.com/*/*/tree/**`. Returns a message telling the agent to use `gh` CLI or clone + scout instead of scraping code.
- **google-docs-redirect**: Matches `docs.google.com/**`. Returns a message telling the agent to use google_workspace_mcp tools.

**Rationale:** These are the two most common cases where web_fetch is the wrong tool. Shipping them as built-in extensions demonstrates the pattern and provides immediate value.

### 7. Pipeline refactoring: break monolithic execute into stages

**Decision:** Refactor the `execute` function into discrete stages that correspond to hook points:
1. URL validation + normalization (no hook — always runs)
2. `beforeFetch` hooks → short-circuit if result returned
3. Cache check + puppeteer fetch → `afterFetch` hooks
4. Trafilatura extraction → `afterExtract` hooks
5. Content processing (prompt/summarize) → `summarize` hooks

Each stage calls matched extensions in order. If any extension returns a result, that result is used and subsequent stages are skipped (for `beforeFetch`) or the hook's return replaces the default output (for `afterExtract`, `summarize`).

**Rationale:** This maps cleanly onto the existing code structure. The current `execute` function already has these stages as sequential blocks — the refactor makes them explicit and injectable.

### 8. Export the extension type for Pi extension authors

**Decision:** pi-web-fetch SHALL export the `WebFetchExtension`, `HookContext`, and `HookResult` types from its package entry point so that Pi extension authors can import them for type safety:

```typescript
// In pi-web-fetch-youtube/index.ts
import type { WebFetchExtension } from "pi-web-fetch";

export default function (pi: ExtensionAPI) {
  const youtube: WebFetchExtension = {
    name: "youtube",
    matches: ["youtube.com/watch**", "youtu.be/**"],
    async beforeFetch(ctx) { /* custom transcript extraction */ }
  };

  const register = () => pi.events.emit("web-fetch:register", youtube);
  register();
  pi.events.on("web-fetch:ready", register);
}
```

**Rationale:** Type exports make the event bus protocol type-safe. Extension authors get autocomplete and compile-time checking. The types are part of pi-web-fetch's public API surface.

## Risks / Trade-offs

**[Performance] Extension matching on every fetch** → Extensions are few (typically <10) and URL matching via picomatch is sub-millisecond. No mitigation needed unless extension count grows dramatically.

**[Complexity] Pipeline short-circuit semantics** → Multiple extensions matching the same URL could cause confusion. Mitigation: first-match-wins rule, clear documentation, and a debug log showing which extension matched.

**[Breaking changes] Extension interface becomes public API** → Once third-party Pi extensions exist, changing the interface requires semver major bumps. Mitigation: keep the v1 interface minimal (only the hooks and context documented above). Add new hooks in minor versions; never remove or change existing hook signatures without a major version.

**[Load order race] Event bus handshake timing** → The two-way handshake handles both load orders, but relies on both extensions following the protocol. Mitigation: document the pattern clearly and provide a helper/example. If a Pi extension registers after session_start has fully completed, its registration still works because pi-web-fetch keeps listening on `web-fetch:register` for the lifetime of the session.

**[File system dependency] Loading local extensions from disk** → Extensions are loaded via dynamic import, which requires the files to be valid ES modules. Malformed extensions could crash the session. Mitigation: wrap each extension load in try/catch, log errors, and continue without the broken extension.

**[Event bus untyped] Pi's event bus uses `unknown` for data** → `pi.events.emit(channel, data: unknown)` provides no type safety at the boundary. Mitigation: pi-web-fetch validates incoming registrations at runtime (checks for required fields `name`, `matches`) and logs a warning for malformed registrations.

**[Scope creep] Auth handling, proxy support, custom fetchers** → The proposal mentions auth and proxy handling but the design explicitly defers these. The hook system makes them possible as future extensions without core changes.

## Open Questions

- Should extension load errors be surfaced as notifications to the user, or silently logged? Notifications are more visible but could be noisy during development.
- Should there be a way to disable built-in extensions via config (e.g., `"disableBuiltins": ["github-redirect"]`)? Useful if the user wants to replace a built-in with a custom version, but adds config surface.
