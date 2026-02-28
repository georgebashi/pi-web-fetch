## ADDED Requirements

### Requirement: Reject and redirect pattern
An extension SHALL be able to reject a URL fetch entirely by returning a `HookResult` from the `beforeFetch` hook. The result SHALL contain actionable instructions telling the agent what tool or approach to use instead of `web_fetch`.

#### Scenario: GitHub code URL rejected
- **WHEN** the `web_fetch` tool is called with `https://github.com/org/repo/blob/main/src/index.ts`
- **THEN** the tool SHALL return a message instructing the agent to use the `gh` CLI or clone the repository instead of scraping code via web_fetch

#### Scenario: Google Docs URL rejected
- **WHEN** the `web_fetch` tool is called with `https://docs.google.com/document/d/abc123/edit`
- **THEN** the tool SHALL return a message instructing the agent to use the google_workspace_mcp tools instead

#### Scenario: Redirect message is actionable
- **WHEN** any redirect extension rejects a URL
- **THEN** the returned message SHALL include specific tool names or commands the agent can use, not just a generic error

#### Scenario: Non-matching URLs pass through
- **WHEN** the `web_fetch` tool is called with a URL that no redirect extension matches (e.g., `https://example.com/article`)
- **THEN** the fetch pipeline SHALL proceed normally with no rejection

### Requirement: Built-in GitHub redirect extension
The extension system SHALL include a built-in extension that matches GitHub source code URLs (`github.com/*/*/blob/**` and `github.com/*/*/tree/**`) and redirects the agent to use the `gh` CLI or clone the repository.

#### Scenario: Blob URL matched
- **WHEN** the URL is `https://github.com/org/repo/blob/main/src/app.ts`
- **THEN** the extension SHALL match and return redirect instructions

#### Scenario: Tree URL matched
- **WHEN** the URL is `https://github.com/org/repo/tree/main/src`
- **THEN** the extension SHALL match and return redirect instructions

#### Scenario: GitHub non-code URL not matched
- **WHEN** the URL is `https://github.com/org/repo/issues/42`
- **THEN** the GitHub redirect extension SHALL NOT match, allowing normal fetch to proceed

#### Scenario: GitHub README/docs page not matched
- **WHEN** the URL is `https://github.com/org/repo` (repository root)
- **THEN** the GitHub redirect extension SHALL NOT match, allowing normal fetch to proceed

### Requirement: Built-in Google Docs redirect extension
The extension system SHALL include a built-in extension that matches Google Docs URLs (`docs.google.com/**`) and redirects the agent to use the google_workspace_mcp tools.

#### Scenario: Google Doc matched
- **WHEN** the URL is `https://docs.google.com/document/d/abc123/edit`
- **THEN** the extension SHALL match and return redirect instructions mentioning google_workspace_mcp

#### Scenario: Google Sheets matched
- **WHEN** the URL is `https://docs.google.com/spreadsheets/d/abc123/edit`
- **THEN** the extension SHALL match and return redirect instructions

#### Scenario: Non-Google-Docs Google URL not matched
- **WHEN** the URL is `https://www.google.com/search?q=test`
- **THEN** the Google Docs redirect extension SHALL NOT match
