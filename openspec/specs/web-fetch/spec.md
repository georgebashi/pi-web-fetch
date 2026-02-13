## ADDED Requirements

### Requirement: Tool registration
The extension SHALL register a single tool named `web_fetch` with pi's tool system. The tool SHALL accept a `url` parameter (required, string) and a `prompt` parameter (optional, string). The tool description SHALL strongly recommend providing a `prompt` parameter to extract specific information, explaining that this is the most effective usage pattern. The description SHALL indicate that omitting the prompt returns raw page content and should only be used when the caller is confident it needs the entire page.

#### Scenario: Tool is available to the LLM
- **WHEN** the extension is loaded by pi
- **THEN** a tool named `web_fetch` SHALL be registered and available in the LLM's tool list

#### Scenario: Tool description guides toward prompted usage
- **WHEN** the LLM reads the tool description
- **THEN** the description SHALL convey that providing a prompt is the preferred and most effective usage, and that fetching without a prompt should only be done when the full page content is needed

#### Scenario: Tool accepts URL only
- **WHEN** the LLM calls `web_fetch` with only a `url` parameter
- **THEN** the tool SHALL execute successfully and return extracted content

#### Scenario: Tool accepts URL and prompt
- **WHEN** the LLM calls `web_fetch` with both `url` and `prompt` parameters
- **THEN** the tool SHALL execute successfully and return an LLM-processed answer

### Requirement: URL validation and normalization
The tool SHALL validate that the `url` parameter is a fully-formed valid URL. HTTP URLs SHALL be automatically upgraded to HTTPS before fetching.

#### Scenario: Valid HTTPS URL
- **WHEN** the tool receives `url: "https://example.com/page"`
- **THEN** the tool SHALL fetch the URL as-is

#### Scenario: HTTP URL upgraded to HTTPS
- **WHEN** the tool receives `url: "http://example.com/page"`
- **THEN** the tool SHALL upgrade the URL to `https://example.com/page` before fetching

#### Scenario: Invalid URL
- **WHEN** the tool receives a malformed URL (e.g., `"not a url"`, `"ftp://example.com"`)
- **THEN** the tool SHALL return an error result with a clear message explaining the URL is invalid

### Requirement: Page fetching via headless Chrome
The tool SHALL fetch web pages using headless Chrome via puppeteer. This SHALL handle JavaScript-rendered content that would not be available via simple HTTP fetch.

#### Scenario: Static HTML page
- **WHEN** the tool fetches a URL serving static HTML
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

### Requirement: Cross-host redirect detection
When a URL redirects to a different host, the tool SHALL NOT follow the redirect. Instead, it SHALL return an informational message containing the redirect URL, allowing the LLM to decide whether to follow it. Same-host redirects SHALL be followed automatically.

#### Scenario: Same-host redirect
- **WHEN** `https://example.com/docs` redirects to `https://example.com/docs/latest`
- **THEN** the tool SHALL follow the redirect and return the content of the final URL

#### Scenario: Cross-host redirect
- **WHEN** `https://example.com/link` redirects to `https://other-domain.com/page`
- **THEN** the tool SHALL return an informational message containing the redirect URL `https://other-domain.com/page`
- **AND** the tool SHALL NOT fetch content from the redirect target

### Requirement: Content extraction via trafilatura
The tool SHALL extract the main content from the fetched HTML and convert it to markdown using trafilatura, invoked via `uvx trafilatura --markdown --formatting`. HTML SHALL be piped to stdin, and extracted markdown SHALL be read from stdout. This SHALL strip boilerplate content such as navigation, ads, footers, and sidebars.

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

### Requirement: Short content returned directly (no prompt)
When no `prompt` is provided and the extracted markdown is below the size threshold, the tool SHALL return the markdown content directly to the LLM.

#### Scenario: Short page without prompt
- **WHEN** the tool is called with only a URL and the extracted markdown is under the size threshold
- **THEN** the tool SHALL return the full extracted markdown as the tool result

### Requirement: Large content summarization (no prompt)
When no `prompt` is provided and the extracted markdown exceeds the size threshold, the tool SHALL use the pi sub-agent to generate a structured summary containing: a brief overview of the whole page, a description of what each section contains, and an invitation for the calling agent to re-query the same URL with a specific prompt to extract the information it needs.

#### Scenario: Large page without prompt
- **WHEN** the tool is called with only a URL and the extracted markdown exceeds the size threshold
- **THEN** the tool SHALL return a structured summary containing:
  - A brief overview of the page's purpose and content
  - A description of each major section and what it covers
  - An explicit suggestion to call `web_fetch` again with the same URL and a `prompt` parameter to extract specific information

#### Scenario: Summary mentions caching
- **WHEN** a large-page summary is generated
- **THEN** the summary SHALL indicate that re-querying the URL will be fast (served from cache)

### Requirement: Prompted content processing via sub-agent
When a `prompt` is provided, the tool SHALL spawn a pi sub-agent to process the extracted markdown with the user's prompt. The sub-agent SHALL use the current session's model and thinking level by default (configurable via `~/.pi/agent/web-fetch.json`), running in JSON mode with no tools and no session.

#### Scenario: Prompted fetch
- **WHEN** the tool is called with a URL and a prompt like "What authentication methods are supported?"
- **THEN** the tool SHALL return a focused answer based on the page content, not the raw markdown

#### Scenario: Sub-agent invocation
- **WHEN** a prompt is provided
- **THEN** the tool SHALL spawn `pi --mode json -p --no-session --no-tools --model <model> --thinking <level>` as a child process, using the configured or session-inherited model and thinking level

#### Scenario: Sub-agent failure fallback
- **WHEN** the sub-agent process fails (e.g., no API key, model unavailable)
- **THEN** the tool SHALL fall back to returning the raw extracted markdown (with truncation if needed) and include a note that LLM processing failed

#### Scenario: Abort signal during sub-agent
- **WHEN** the abort signal is triggered while the sub-agent is running
- **THEN** the tool SHALL kill the sub-agent process (SIGTERM, then SIGKILL after 5 seconds) and return promptly

### Requirement: Response caching
The tool SHALL cache fetched and extracted content in memory with a 15-minute TTL. The cache key SHALL be the normalized URL (after HTTP→HTTPS upgrade). A periodic cleanup SHALL run to remove expired entries and prevent unbounded memory growth.

#### Scenario: Cache hit
- **WHEN** the same URL is fetched within 15 minutes of a previous fetch
- **THEN** the tool SHALL return the cached content without re-fetching

#### Scenario: Cache miss after expiry
- **WHEN** a URL is fetched more than 15 minutes after the previous fetch
- **THEN** the tool SHALL re-fetch the URL from the network

#### Scenario: Cache serves both prompted and non-prompted calls
- **WHEN** a URL was previously fetched without a prompt, and is now called with a prompt
- **THEN** the cached extracted markdown SHALL be reused, and only the sub-agent processing SHALL execute

#### Scenario: Cache cleanup
- **WHEN** expired entries exist in the cache
- **THEN** a periodic cleanup (every 5 minutes) SHALL remove them

### Requirement: Dependency checking on startup
The extension SHALL check for required dependencies (`uvx`, puppeteer) on `session_start`. Missing dependencies SHALL trigger a clear error notification to the user.

#### Scenario: All dependencies present
- **WHEN** the extension loads and `uvx` and puppeteer are all available
- **THEN** the extension SHALL load normally with no warnings

#### Scenario: uvx missing
- **WHEN** the extension loads and `uvx` is not found on PATH
- **THEN** the extension SHALL display an error notification explaining that uv is required and how to install it
