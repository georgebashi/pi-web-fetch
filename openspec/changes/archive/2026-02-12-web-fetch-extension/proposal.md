## Why

AI coding agents frequently need to access web content — documentation pages, API references, blog posts, release notes — but lack a reliable way to fetch and extract readable content from URLs. Raw HTML is noisy and token-expensive. This extension provides a `web_fetch` tool that fetches a URL via headless Chrome (handling JS-rendered content), extracts the main content and converts it to clean markdown via trafilatura, and processes the content with a user-supplied prompt using a small, fast LLM — returning a focused answer rather than dumping raw page content into context.

## What Changes

- Add a new pi extension that registers a `web_fetch` tool for fetching and analyzing web content
- The tool takes a **URL** and an optional **prompt** describing what information to extract
- Fetches the URL via headless Chrome (handles JS-rendered pages), extracts main content and converts to markdown using **trafilatura** (via `uvx`) — strips boilerplate, navigation, ads
- If a **prompt** is provided, spawns a lightweight **pi sub-agent** (`pi --mode json -p --no-session`) with the extracted markdown as context and the user's prompt, using a small/fast model — returns the sub-agent's focused answer
- If **no prompt** is provided and the content is short enough, returns the extracted markdown directly
- If **no prompt** is provided and the content is **large**, uses the sub-agent to generate a structured summary (page overview, section descriptions) and invites the caller to re-query with a specific prompt
- Includes a **self-cleaning cache** (15-minute TTL) for repeated access to the same URL — enables the summarize-then-drill-down pattern
- Handles **redirects**: when a URL redirects to a different host, informs the caller and provides the redirect URL for a follow-up request
- Automatically **upgrades HTTP to HTTPS**
- Applies **output truncation** if content is very large (using pi's truncation utilities)
- Read-only tool — does not modify any files
- Package as a directory-based extension with `package.json` for Node dependencies

## Capabilities

### New Capabilities
- `web-fetch`: Single tool that fetches a web page via headless Chrome, extracts main content and converts to markdown via trafilatura (invoked via `uvx`), and optionally processes the content with a user-supplied prompt via a lightweight pi sub-agent (gemini-3-flash with thinking). When no prompt is given: returns markdown directly if short, or generates a structured page summary (overview + section descriptions) for large pages, inviting the caller to re-query with a specific prompt. Covers URL fetching, JS rendering, content extraction (boilerplate removal), markdown conversion, redirect detection, HTTP-to-HTTPS upgrade, response caching (15-min TTL), sub-agent LLM processing, intelligent summarization of large pages, and error handling.

### Modified Capabilities

_(none — this is a greenfield extension)_

## Impact

- **Dependencies**: Requires headless Chrome/Chromium (via puppeteer) as an npm dependency, and `uvx` (from `uv`) to run trafilatura for content extraction and markdown conversion. No manual Python package installation needed — `uvx` handles it automatically.
- **APIs**: Registers one new tool (`web_fetch`) in the pi tool system available to the LLM.
- **Extension structure**: Directory-based extension with `package.json` for npm dependencies.
- **LLM usage**: When a prompt is provided, the tool spawns a stripped-down pi sub-agent process (`pi --mode json -p --no-session --no-tools --model gemini-3-flash --thinking`) to process the content. Also used to generate structured summaries of large pages when no prompt is given. This is a self-contained subprocess — no dependency on the subagent extension.
- **Token budget**: When a prompt is given, content is processed by the sub-agent and a focused answer is returned, keeping the main agent's context lean. When no prompt is given, short content is returned directly; large content is summarized with section descriptions, inviting the caller to re-query with a specific prompt (served from cache).
- **Network**: Makes outbound HTTP/HTTPS requests; users should be aware of privacy/security implications.
- **Caching**: In-memory cache with 15-minute TTL and self-cleaning to avoid unbounded memory growth.
