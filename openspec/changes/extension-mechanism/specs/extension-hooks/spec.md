## ADDED Requirements

### Requirement: Extension interface contract
An extension SHALL be a module whose default export is a factory function returning a `WebFetchExtension` object. The object SHALL contain a `name` (string), `matches` (array of URL glob patterns), and optional hook functions: `beforeFetch`, `afterFetch`, `afterExtract`, `summarize`.

#### Scenario: Minimal extension with one hook
- **WHEN** a module exports a factory function returning `{ name: "my-ext", matches: ["example.com/**"], beforeFetch: async (ctx) => ctx.redirect("Use a different tool") }`
- **THEN** the extension system SHALL accept it as a valid extension

#### Scenario: Extension with all hooks
- **WHEN** an extension provides all four hook functions (`beforeFetch`, `afterFetch`, `afterExtract`, `summarize`)
- **THEN** the extension system SHALL invoke each hook at the appropriate pipeline stage

#### Scenario: Extension with no hooks
- **WHEN** an extension provides a `name` and `matches` but no hook functions
- **THEN** the extension system SHALL accept it but never invoke it during pipeline execution

### Requirement: Hook lifecycle ordering
The extension system SHALL invoke hooks in this order during a fetch: `beforeFetch` → `afterFetch` → `afterExtract` → `summarize`. Each hook SHALL only be invoked if the pipeline reaches that stage (i.e., a short-circuit in an earlier hook skips all later hooks).

#### Scenario: Normal pipeline with all hooks
- **WHEN** an extension matches a URL and provides all four hooks, and no hook short-circuits
- **THEN** the hooks SHALL be invoked in order: `beforeFetch`, `afterFetch`, `afterExtract`, `summarize`

#### Scenario: beforeFetch short-circuits
- **WHEN** an extension's `beforeFetch` hook returns a `HookResult`
- **THEN** the pipeline SHALL skip fetching, extraction, and summarization, and return the `HookResult` directly as the tool response

#### Scenario: afterExtract replaces content
- **WHEN** an extension's `afterExtract` hook returns a string
- **THEN** the returned string SHALL replace the extracted markdown for all subsequent processing (summarization, caching)

### Requirement: HookContext provides URL, signal, and redirect helper
Each hook SHALL receive a `HookContext` containing: the normalized `url` (string), a `parsedUrl` (URL object), the optional `prompt` (string), and the optional `signal` (AbortSignal). The context SHALL also provide a `redirect(message: string)` helper method that returns a properly formatted `HookResult` for the rejection/redirect pattern.

#### Scenario: HookContext contains normalized URL
- **WHEN** the tool is called with `http://example.com/page`
- **THEN** the `HookContext.url` passed to hooks SHALL be `https://example.com/page` (normalized)

#### Scenario: Redirect helper produces actionable response
- **WHEN** a hook calls `ctx.redirect("Clone the repo instead: git clone https://github.com/org/repo")`
- **THEN** the returned `HookResult` SHALL contain the message text and SHALL be returned to the agent as the tool result

#### Scenario: Hook receives abort signal
- **WHEN** the abort signal is triggered while a hook is executing
- **THEN** the `signal.aborted` property on the `HookContext` SHALL be `true`

### Requirement: afterFetch hook receives HTML
The `afterFetch` hook SHALL receive the `HookContext` extended with an `html` property containing the raw HTML fetched from the page.

#### Scenario: afterFetch can inspect HTML
- **WHEN** a page is fetched and an extension's `afterFetch` hook is invoked
- **THEN** the hook SHALL receive the full HTML content of the fetched page in its `html` parameter

#### Scenario: afterFetch can rewrite HTML
- **WHEN** an extension's `afterFetch` hook returns an object with an `html` property
- **THEN** the returned HTML SHALL replace the fetched HTML for extraction

### Requirement: afterExtract hook receives markdown
The `afterExtract` hook SHALL receive the `HookContext` extended with a `markdown` property containing the trafilatura-extracted markdown.

#### Scenario: afterExtract can transform content
- **WHEN** an extension's `afterExtract` hook returns a string
- **THEN** the returned string SHALL replace the extracted markdown for caching and any subsequent processing

#### Scenario: afterExtract returns void for no-op
- **WHEN** an extension's `afterExtract` hook returns `void` or `undefined`
- **THEN** the original extracted markdown SHALL be used unchanged

### Requirement: summarize hook can replace LLM processing
The `summarize` hook SHALL receive the `HookContext` extended with `markdown` (extracted content) and optional `prompt` (user's prompt). If it returns a `HookResult`, that result SHALL replace the default sub-agent summarization.

#### Scenario: Custom summarization
- **WHEN** an extension's `summarize` hook returns a `HookResult`
- **THEN** the pipeline SHALL use that result instead of invoking the pi sub-agent

#### Scenario: Summarize hook passes through
- **WHEN** an extension's `summarize` hook returns `void`
- **THEN** the default sub-agent summarization SHALL proceed normally

### Requirement: First-match-wins for multiple matching extensions
When multiple extensions match a URL, the extension system SHALL use the first matching extension only. User extensions SHALL be checked before built-in extensions.

#### Scenario: Two extensions match same URL
- **WHEN** extension A (user) and extension B (built-in) both match `github.com/org/repo/blob/main/file.ts`
- **THEN** only extension A's hooks SHALL be invoked

#### Scenario: No extensions match
- **WHEN** no extension matches the URL being fetched
- **THEN** the pipeline SHALL proceed with default behavior (no hooks invoked)
