## MODIFIED Requirements

### Requirement: Page fetching via headless Chrome
The tool SHALL fetch web pages using headless Chrome via puppeteer. This SHALL handle JavaScript-rendered content that would not be available via simple HTTP fetch. Before fetching, the pipeline SHALL invoke `beforeFetch` hooks on any matching extension. If a `beforeFetch` hook returns a result, the fetch SHALL be skipped and the hook's result SHALL be returned directly.

#### Scenario: Static HTML page
- **WHEN** the tool fetches a URL serving static HTML and no extension matches
- **THEN** the tool SHALL retrieve the full HTML content of the page

#### Scenario: JavaScript-rendered page
- **WHEN** the tool fetches a URL where content is rendered by JavaScript (e.g., a React SPA)
- **THEN** the tool SHALL wait for the page to render and retrieve the final DOM content

#### Scenario: Page load timeout
- **WHEN** the page fails to load within 30 seconds
- **THEN** the tool SHALL return an error result indicating a timeout occurred

#### Scenario: Network error
- **WHEN** the page cannot be reached (DNS failure, connection refused, etc.)
- **THEN** the tool SHALL return an error result with the specific network error

#### Scenario: Abort signal during fetch
- **WHEN** the abort signal is triggered while the page is loading
- **THEN** the tool SHALL kill the browser process and return promptly

#### Scenario: beforeFetch hook short-circuits fetch
- **WHEN** a matching extension's `beforeFetch` hook returns a `HookResult`
- **THEN** the tool SHALL NOT launch puppeteer and SHALL return the hook's result directly

#### Scenario: beforeFetch hook passes through
- **WHEN** a matching extension's `beforeFetch` hook returns `void`
- **THEN** the tool SHALL proceed with normal puppeteer-based fetching

### Requirement: Content extraction via trafilatura
The tool SHALL extract the main content from the fetched HTML and convert it to markdown using trafilatura, invoked via `uvx trafilatura --markdown --formatting`. HTML SHALL be piped to stdin, and extracted markdown SHALL be read from stdout. This SHALL strip boilerplate content such as navigation, ads, footers, and sidebars. After extraction, the pipeline SHALL invoke `afterExtract` hooks on any matching extension, allowing content transformation.

#### Scenario: Page with boilerplate
- **WHEN** the fetched HTML contains navigation, ads, footer, and main article content
- **THEN** the extracted markdown SHALL contain only the main article content

#### Scenario: Markdown output format
- **WHEN** content is extracted from any page
- **THEN** the output SHALL be valid markdown with proper headings, links, and formatting preserved

#### Scenario: uvx not installed
- **WHEN** `uvx` is not available on the system
- **THEN** the extension SHALL show a clear error notification on session start explaining how to install uv (`curl -LsSf https://astral.sh/uv/install.sh | sh`)

#### Scenario: Extraction failure
- **WHEN** trafilatura fails to extract content (empty result or process error)
- **THEN** the tool SHALL return an error result indicating content extraction failed

#### Scenario: afterExtract hook transforms content
- **WHEN** a matching extension's `afterExtract` hook returns a string
- **THEN** the returned string SHALL replace the extracted markdown for caching and subsequent processing

#### Scenario: afterFetch hook transforms HTML
- **WHEN** a matching extension's `afterFetch` hook returns an object with an `html` property
- **THEN** the returned HTML SHALL be used for trafilatura extraction instead of the originally fetched HTML

### Requirement: Prompted content processing via sub-agent
When a `prompt` is provided, the tool SHALL spawn a pi sub-agent to process the extracted markdown with the user's prompt. The sub-agent SHALL use the current session's model and thinking level by default (configurable via `~/.pi/agent/web-fetch.json`), running in JSON mode with no tools and no session. Before invoking the sub-agent, the pipeline SHALL invoke `summarize` hooks on any matching extension, allowing custom processing to replace the default sub-agent.

#### Scenario: Prompted fetch
- **WHEN** the tool is called with a URL and a prompt like "What authentication methods are supported?"
- **THEN** the tool SHALL return a focused answer based on the page content, not the raw markdown

#### Scenario: Sub-agent invocation
- **WHEN** a prompt is provided and no summarize hook returns a result
- **THEN** the tool SHALL spawn `pi --mode json -p --no-session --no-tools --model <model> --thinking <level>` as a child process, using the configured or session-inherited model and thinking level

#### Scenario: Sub-agent failure fallback
- **WHEN** the sub-agent process fails (e.g., no API key, model unavailable)
- **THEN** the tool SHALL fall back to returning the raw extracted markdown (with truncation if needed) and include a note that LLM processing failed

#### Scenario: Abort signal during sub-agent
- **WHEN** the abort signal is triggered while the sub-agent is running
- **THEN** the tool SHALL kill the sub-agent process (SIGTERM, then SIGKILL after 5 seconds) and return promptly

#### Scenario: summarize hook replaces sub-agent
- **WHEN** a matching extension's `summarize` hook returns a `HookResult`
- **THEN** the tool SHALL use that result instead of spawning the pi sub-agent
