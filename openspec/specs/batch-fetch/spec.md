## ADDED Requirements

### Requirement: Batch URL parameter
The `web_fetch` tool SHALL accept an optional `pages` parameter: an array of objects, each containing a `url` (required, string) and `prompt` (optional, string). When `pages` is provided, the tool SHALL process all entries concurrently. The `pages` parameter and the top-level `url` parameter SHALL be mutually exclusive — providing both SHALL result in a validation error.

#### Scenario: Batch call with multiple URLs
- **WHEN** the tool is called with `pages: [{ url: "https://a.com" }, { url: "https://b.com", prompt: "summary" }]`
- **THEN** the tool SHALL fetch and process both URLs concurrently and return results for each

#### Scenario: Batch call with prompts per page
- **WHEN** the tool is called with `pages` where some entries have `prompt` and others do not
- **THEN** each page SHALL be processed according to its own `prompt` value (prompted pages get LLM processing, unprompted pages get raw/summarized content)

#### Scenario: Mutual exclusivity with url parameter
- **WHEN** the tool is called with both `url` and `pages` parameters
- **THEN** the tool SHALL return an error result explaining that `url` and `pages` are mutually exclusive

#### Scenario: Empty pages array
- **WHEN** the tool is called with `pages: []`
- **THEN** the tool SHALL return an error result explaining that at least one page is required

### Requirement: Batch size limit
The `pages` array SHALL accept a maximum of 10 entries. Exceeding this limit SHALL result in a validation error.

#### Scenario: Batch within limit
- **WHEN** the tool is called with `pages` containing 10 or fewer entries
- **THEN** the tool SHALL process all entries normally

#### Scenario: Batch exceeds limit
- **WHEN** the tool is called with `pages` containing more than 10 entries
- **THEN** the tool SHALL return an error result explaining the maximum batch size is 10

### Requirement: Concurrent page processing
When processing a batch, all pages SHALL be fetched and processed concurrently, bounded by the browser pool's maximum tab limit. A failure in one page SHALL NOT abort processing of other pages. Each page SHALL go through the full pipeline independently: URL validation → cache check → extension hooks → fetch → extract → process.

#### Scenario: Independent failure handling
- **WHEN** a batch of 3 pages is requested and the second URL fails to load
- **THEN** the first and third pages SHALL return their results successfully
- **AND** the second page SHALL return an error message within the batch results

#### Scenario: Concurrent execution bounded by browser pool
- **WHEN** a batch of 8 pages is requested and the browser pool has a max of 6 tabs
- **THEN** 6 pages SHALL begin fetching immediately and the remaining 2 SHALL queue until tabs become available

#### Scenario: Cache hits in batch
- **WHEN** a batch includes a URL that is already cached
- **THEN** the cached URL SHALL return immediately from cache while other URLs are fetched from the network

#### Scenario: Extension hooks per page
- **WHEN** a batch includes URLs that match different extensions
- **THEN** each URL SHALL be processed through its own matched extension's hook pipeline independently

### Requirement: Batch result format
For batch calls, the tool SHALL return results as a single text content block with each page's result clearly delimited. Each page's section SHALL be prefixed with a header line showing its index and URL (e.g., `--- [1/3] https://example.com ---`). Error results for individual pages SHALL be included inline within their section.

#### Scenario: All pages succeed
- **WHEN** a batch of 3 pages all complete successfully
- **THEN** the tool SHALL return a single text block containing all 3 results, each prefixed with `--- [N/3] <url> ---`

#### Scenario: Mixed success and failure
- **WHEN** a batch of 3 pages is requested and one fails
- **THEN** the tool SHALL return a single text block where the successful pages show their content and the failed page shows its error message, all with index/URL headers

#### Scenario: Result ordering
- **WHEN** a batch is processed and pages complete in a different order than requested
- **THEN** the results SHALL be returned in the original request order (matching the `pages` array index)

### Requirement: Batch progress updates
During batch processing, the tool SHALL emit progress updates via `onUpdate` showing the count of completed pages (e.g., "Fetching 5 pages... (2/5 done)").

#### Scenario: Progress during batch fetch
- **WHEN** a batch of 5 pages is being processed
- **THEN** the tool SHALL emit progress updates as pages complete, showing the running count

#### Scenario: Initial progress update
- **WHEN** a batch begins processing
- **THEN** the tool SHALL emit an initial update indicating the total number of pages being fetched
