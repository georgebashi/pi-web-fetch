## Context

This is a greenfield pi extension for the `pi-web-fetch` project. There is no existing code — we're building a directory-based extension from scratch.

The extension needs to orchestrate three external processes:
1. **Headless Chrome** (via puppeteer) — to fetch and render JS-heavy pages
2. **Trafilatura** (via `uvx`) — to extract main content from HTML and convert to markdown
3. **pi sub-agent** (optional) — to process extracted content with an LLM when a prompt is provided

The extension runs inside pi's extension runtime (loaded via jiti, TypeScript without compilation). It registers a single `web_fetch` tool that the LLM can call.

## Goals / Non-Goals

**Goals:**
- Provide a single `web_fetch` tool that reliably fetches and extracts web page content
- Handle JS-rendered pages via headless Chrome
- Strip boilerplate (nav, ads, footers) and return clean markdown via trafilatura
- Optionally process content with an LLM prompt via a pi sub-agent
- Cache fetched content to avoid redundant network requests
- Handle edge cases: redirects, HTTP→HTTPS upgrade, large pages, timeouts
- Follow pi extension conventions (truncation, abort signals, proper error reporting)

**Non-Goals:**
- Authentication/login flows for protected pages
- PDF, video, or non-HTML content extraction
- Crawling multiple pages or following links
- Persistent/disk-based caching across sessions
- Custom browser profiles or cookie management
- Acting as a general-purpose web scraper

## Decisions

### 1. Puppeteer for headless Chrome

**Choice:** Use `puppeteer` (npm package) to control headless Chrome.

**Rationale:** Puppeteer bundles a compatible Chromium binary, so users don't need to install Chrome separately. It has first-class TypeScript support and is the most widely used headless browser library in the Node ecosystem.

**Alternatives considered:**
- *Playwright* — more features (multi-browser), but heavier install and we only need Chrome. Puppeteer is simpler for single-browser use.
- *Raw fetch + jsdom* — would miss JS-rendered content, which is a core requirement.

### 2. Trafilatura via `uvx`

**Choice:** Invoke trafilatura's CLI via `uvx trafilatura --markdown --formatting`, piping HTML via stdin and receiving markdown via stdout.

**Rationale:** Trafilatura is a Python library with no JS equivalent. It excels at boilerplate removal and main content extraction — significantly better than simple HTML-to-markdown converters like turndown. Using `uvx` (from `uv`) means users don't need to manually install trafilatura or manage Python environments — `uvx` handles downloading and running it in an ephemeral environment automatically. This eliminates the need for a custom Python script.

**Implementation:** The extension spawns `uvx trafilatura --markdown --formatting` and pipes the fetched HTML to stdin. The extracted markdown is collected from stdout. The first invocation may take a few seconds as `uvx` downloads the package, but subsequent runs use a cached environment.

**Alternatives considered:**
- *Custom Python script with `python3`* — requires users to `pip install trafilatura` manually. More setup friction.
- *Turndown (JS)* — pure JS HTML-to-markdown, but no boilerplate removal. Would include nav, ads, footers.
- *Readability.js + Turndown* — Mozilla's Readability can extract main content, then Turndown converts. Decent but trafilatura is more robust and handles more edge cases.
- *Python bindings via napi* — too complex for this use case.

### 3. Pi sub-agent for LLM processing

**Choice:** When a `prompt` parameter is provided, spawn `pi --mode json -p --no-session --no-tools --model <model>` as a child process. Pass the extracted markdown + user prompt as the input. Parse the JSON output stream for the assistant's response.

**Rationale:** Reuses pi's existing model registry and API key management — no need to implement LLM API calls directly. The `--no-tools` flag ensures the sub-agent just answers the question without attempting tool calls. JSON mode gives us structured output we can parse.

**Model selection:** Use `gemini-3-flash` with thinking enabled by default. This model is fast, cheap, and the thinking capability helps it reason about complex page content. The model name can be configurable via an environment variable or extension config in the future.

**Alternatives considered:**
- *Direct API calls* — would need to handle API keys, model selection, and streaming ourselves. Duplicates what pi already does.
- *Depending on the subagent extension* — adds an external dependency. A self-contained spawn is simpler and more portable.
- *Using pi's model registry directly from the extension* — the extension context provides `ctx.modelRegistry` but not a way to make LLM calls directly. Spawning pi is the sanctioned approach.

### 4. In-memory cache with 15-minute TTL

**Choice:** Cache fetched+extracted content in a `Map<string, { content: string; timestamp: number }>`. Entries expire after 15 minutes. A periodic cleanup runs every 5 minutes to remove stale entries.

**Rationale:** Avoids redundant fetches when the LLM repeatedly accesses the same URL (common when exploring documentation). 15 minutes is long enough to be useful during a session but short enough that stale content isn't a problem.

**Cache key:** The normalized URL (after HTTP→HTTPS upgrade, before redirect).

**Alternatives considered:**
- *No cache* — wastes time and bandwidth on repeated fetches.
- *Disk cache* — more complex, survives restarts but unnecessary for typical session lengths.
- *LRU cache with size limit* — could add later if memory becomes an issue. For now, the 15-min TTL with cleanup is sufficient.

### 5. Redirect handling

**Choice:** When puppeteer detects a redirect to a different host, return an informational message to the LLM with the redirect URL instead of following it blindly. The LLM can then make a new `web_fetch` call with the redirect URL.

**Rationale:** Following cross-host redirects silently could lead to unexpected content (e.g., login pages, CDN errors). Making the redirect explicit lets the LLM decide whether to follow it. Same-host redirects (e.g., `/docs` → `/docs/latest`) are followed automatically.

### 6. Extension structure

**Choice:** Directory-based extension with this layout:

```
pi-web-fetch/
├── package.json          # npm deps (puppeteer)
├── src/
│   └── index.ts          # Extension entry point
└── README.md
```

The `package.json` declares `puppeteer` as a dependency. The `pi` field in `package.json` points to `src/index.ts` as the extension entry point. Users install with `npm install` and either symlink or reference in pi's settings.

**Rationale:** Follows pi's directory-based extension pattern with `package.json` for dependencies. No custom Python scripts needed — trafilatura is invoked directly via `uvx`.

## Risks / Trade-offs

- **[uvx dependency]** → Users must have `uvx` (from `uv`) installed. Mitigation: `uv` is increasingly standard in the Python ecosystem. Check for `uvx` on extension load (`session_start`), show a clear error notification if missing with install instructions (`curl -LsSf https://astral.sh/uv/install.sh | sh`).

- **[First-run latency]** → The first `uvx trafilatura` invocation downloads the package (~10MB). Mitigation: Subsequent runs use the cached environment and are fast. Document this in README.

- **[Puppeteer binary size]** → Puppeteer downloads ~300MB of Chromium. Mitigation: Document this in README. Consider supporting `PUPPETEER_EXECUTABLE_PATH` for users who already have Chrome installed.

- **[Page load timeouts]** → Some pages take very long to render. Mitigation: Set a 30-second timeout on page.goto(). Return a clear error on timeout.

- **[Large pages]** → Some pages produce enormous markdown output. Mitigation: When no prompt is given and content exceeds the size threshold (e.g., 50KB / 2000 lines), instead of truncating, use the sub-agent to generate a structured summary: a brief overview of the whole page, a description of what each section contains, and an invitation for the calling agent to re-query the same URL (which will be served from cache) with a specific prompt to extract the information it needs. This approach preserves the information architecture of the page rather than arbitrarily cutting it off. When a prompt IS given, the sub-agent processes the full content regardless of size (bounded only by the sub-agent's own context window).

- **[Sub-agent failure]** → The pi subprocess could fail (no API key, model unavailable, etc.). Mitigation: Fall back to returning the raw extracted markdown with a note that LLM processing failed.

- **[Abort handling]** → The tool must respect `signal.aborted` and kill child processes (puppeteer, uvx, pi) on abort. Mitigation: Wire up abort signal listeners to kill all spawned processes with SIGTERM, then SIGKILL after 5 seconds.
