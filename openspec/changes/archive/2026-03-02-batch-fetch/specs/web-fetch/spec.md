## MODIFIED Requirements

### Requirement: Tool registration
The extension SHALL register a single tool named `web_fetch` with pi's tool system. The tool SHALL accept **either** the existing single-URL parameters (`url` required string, `prompt` optional string) **or** a `pages` parameter (array of `{ url, prompt? }` objects) for batch fetching. The `url` and `pages` parameters SHALL be mutually exclusive. The tool description SHALL strongly recommend providing a `prompt` parameter to extract specific information, explaining that this is the most effective usage pattern. The description SHALL indicate that omitting the prompt returns raw page content and should only be used when the caller is confident it needs the entire page. The description SHALL document the `pages` parameter for fetching multiple URLs in a single call and recommend it when the agent needs to fetch several pages.

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

#### Scenario: Tool accepts pages array
- **WHEN** the LLM calls `web_fetch` with a `pages` parameter containing an array of URL+prompt objects
- **THEN** the tool SHALL execute successfully and return results for all pages

#### Scenario: Tool description documents batch usage
- **WHEN** the LLM reads the tool description
- **THEN** the description SHALL document the `pages` parameter for fetching multiple URLs concurrently in a single call
