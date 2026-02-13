## 1. Project Scaffolding

- [x] 1.1 Create `package.json` with project metadata, `puppeteer` dependency, and `pi.extensions` entry pointing to `src/index.ts`
- [x] 1.2 Create directory structure: `src/`
- [x] 1.3 Run `npm install` to install puppeteer and generate `package-lock.json`
- [x] 1.4 Create `README.md` with installation instructions (npm install, uvx/uv requirement, puppeteer Chromium download note, `PUPPETEER_EXECUTABLE_PATH` option)

## 2. Extension Entry Point and Dependency Checks

- [x] 2.1 Create `src/index.ts` with the extension default export function skeleton
- [x] 2.2 Implement `session_start` handler that checks for `uvx` on PATH, showing `ctx.ui.notify` error if missing with install instructions
- [x] 2.3 Register the `web_fetch` tool with TypeBox schema: `url` (required string), `prompt` (optional string), and a description that strongly recommends providing a prompt for most effective usage

## 3. URL Validation and Normalization

- [x] 3.1 Implement URL validation: reject malformed URLs and non-HTTP(S) schemes, return clear error
- [x] 3.2 Implement HTTP→HTTPS auto-upgrade for `http://` URLs
- [x] 3.3 Implement URL normalization for cache key generation (after scheme upgrade)

## 4. Response Cache

- [x] 4.1 Implement in-memory cache: `Map<string, { content: string; timestamp: number }>` with 15-minute TTL
- [x] 4.2 Implement cache lookup in the tool's execute path — return cached content on hit, skip fetch+extract
- [x] 4.3 Implement periodic cleanup (every 5 minutes) to remove expired entries; clear interval on `session_shutdown`

## 5. Page Fetching via Puppeteer

- [x] 5.1 Implement `fetchPage(url, signal)` function: launch headless Chrome, navigate to URL with 30-second timeout, retrieve rendered HTML, close browser
- [x] 5.2 Implement cross-host redirect detection: intercept navigation responses, compare request host vs response host, return redirect info instead of content for cross-host redirects
- [x] 5.3 Implement same-host redirect following (default puppeteer behavior, just verify)
- [x] 5.4 Implement abort signal handling: kill browser process on signal abort (SIGTERM, then SIGKILL after 5s)
- [x] 5.5 Handle error cases: timeout, network errors, non-200 responses — return clear error results

## 6. Content Extraction via Trafilatura

- [x] 6.1 Implement `extractContent(html, signal)` function: spawn `uvx trafilatura --markdown --formatting`, pipe HTML via stdin, collect markdown from stdout
- [x] 6.2 Handle extraction failures: non-zero exit code, empty stdout, stderr messages — return clear error
- [x] 6.3 Implement abort signal handling: kill uvx process on signal abort

## 7. Sub-Agent for LLM Processing

- [x] 7.1 Implement `runSubAgent(content, prompt, signal)` function: spawn `pi --mode json -p --no-session --no-tools --model gemini-3-flash --thinking` with the combined content+prompt as input
- [x] 7.2 Parse JSON output stream from the sub-agent: collect `message_end` events, extract final assistant text response
- [x] 7.3 Implement abort signal handling: kill pi process on signal abort (SIGTERM, then SIGKILL after 5s)
- [x] 7.4 Implement failure fallback: on sub-agent error, return raw extracted markdown with truncation and a note that LLM processing failed

## 8. Tool Execute — Orchestration

- [x] 8.1 Wire up the full tool execute flow: validate URL → check cache → fetch page → extract content → store in cache → return/process
- [x] 8.2 Implement no-prompt short content path: if content is below size threshold, return markdown directly
- [x] 8.3 Implement no-prompt large content path: if content exceeds size threshold, invoke sub-agent with a summarization prompt that produces page overview, section descriptions, and re-query invitation
- [x] 8.4 Implement prompted path: invoke sub-agent with extracted markdown + user prompt
- [x] 8.5 Implement streaming progress updates via `onUpdate` callback (e.g., "Fetching...", "Extracting content...", "Processing with LLM...")
- [x] 8.6 Ensure cached content is reused across no-prompt and prompted calls to the same URL

## 9. Custom Rendering

- [x] 9.1 Implement `renderCall` for the tool: show URL and prompt (if any) in a compact format
- [x] 9.2 Implement `renderResult` for the tool: show success/error status, content preview (collapsed), full content or LLM answer (expanded)

## 10. Testing and Polish

- [x] 10.1 End-to-end test: load extension in pi, call `web_fetch` with a real URL (no prompt), verify markdown output
- [x] 10.2 End-to-end test: call `web_fetch` with a URL and prompt, verify focused LLM answer
- [x] 10.3 End-to-end test: call `web_fetch` with a large page (no prompt), verify structured summary with section descriptions and re-query invitation
- [x] 10.4 End-to-end test: verify cache hit on second call to same URL
- [x] 10.5 End-to-end test: verify cross-host redirect returns informational message
- [x] 10.6 Verify dependency check notifications when uvx is missing
