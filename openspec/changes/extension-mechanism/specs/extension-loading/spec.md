## ADDED Requirements

### Requirement: Extension discovery from local directory
The extension system SHALL scan `~/.pi/extensions/web-fetch/` for extension modules at session start. Each `.ts` or `.js` file in the directory SHALL be treated as a potential extension. The directory path SHALL be configurable via the `extensionsDir` field in `~/.pi/agent/web-fetch.json`.

#### Scenario: Default extension directory
- **WHEN** no `extensionsDir` is configured in `web-fetch.json`
- **THEN** the system SHALL look for extensions in `~/.pi/extensions/web-fetch/`

#### Scenario: Custom extension directory
- **WHEN** `web-fetch.json` contains `"extensionsDir": "/path/to/my/extensions"`
- **THEN** the system SHALL load extensions from `/path/to/my/extensions/` instead of the default

#### Scenario: Extension directory does not exist
- **WHEN** the extension directory does not exist on disk
- **THEN** the system SHALL proceed normally with only built-in and event-bus extensions (no error)

### Requirement: Extension loading via dynamic import
Each local extension module SHALL be loaded via dynamic `import()`. The module's default export SHALL be a factory function that returns a `WebFetchExtension` object. If the module does not have a valid default export, it SHALL be skipped with a warning.

#### Scenario: Valid extension module
- **WHEN** a file at `~/.pi/extensions/web-fetch/my-handler.ts` exports a default function returning a `WebFetchExtension`
- **THEN** the extension SHALL be loaded and registered

#### Scenario: Module with no default export
- **WHEN** a file exists in the extensions directory but has no default export
- **THEN** the system SHALL log a warning and skip that file

#### Scenario: Module throws during load
- **WHEN** an extension module throws an error during import or factory invocation
- **THEN** the system SHALL log the error, skip that extension, and continue loading remaining extensions

### Requirement: Built-in extension loading
The extension system SHALL load built-in extensions bundled with the pi-web-fetch package. Built-in extensions SHALL be loaded from the `extensions/` subdirectory relative to the package root.

#### Scenario: Built-in extensions always available
- **WHEN** the extension loads with no local or event-bus extensions registered
- **THEN** built-in extensions (e.g., github-redirect, google-docs-redirect) SHALL still be active

### Requirement: Pi extension registration via event bus
The extension system SHALL support registration of site handlers from separate Pi extensions (e.g., `pi-web-fetch-youtube`) via Pi's shared event bus (`pi.events`). pi-web-fetch SHALL subscribe to the `web-fetch:register` channel and accept `WebFetchExtension` objects emitted on it.

#### Scenario: Pi extension registers after pi-web-fetch loads
- **WHEN** pi-web-fetch has already loaded and subscribed to `web-fetch:register`
- **AND** a separate Pi extension emits `pi.events.emit("web-fetch:register", extensionObject)`
- **THEN** the extension SHALL be added to the handler registry immediately

#### Scenario: Pi extension registers before pi-web-fetch loads
- **WHEN** a separate Pi extension loads before pi-web-fetch and emits `web-fetch:register`
- **AND** pi-web-fetch subsequently loads and emits `web-fetch:ready`
- **THEN** the separate Pi extension SHALL re-register when it receives the `web-fetch:ready` event
- **AND** pi-web-fetch SHALL accept the registration

#### Scenario: Invalid registration payload
- **WHEN** something emits `web-fetch:register` with a payload missing required fields (`name` or `matches`)
- **THEN** the system SHALL log a warning and ignore the registration

### Requirement: Event bus ready signal
pi-web-fetch SHALL emit a `web-fetch:ready` event on Pi's event bus after it has subscribed to `web-fetch:register` and loaded its built-in and local extensions. This signals to other Pi extensions that pi-web-fetch is ready to accept registrations.

#### Scenario: Ready signal emitted on session start
- **WHEN** pi-web-fetch completes its session_start initialization
- **THEN** it SHALL emit `pi.events.emit("web-fetch:ready")` on the event bus

#### Scenario: Late-loading Pi extension receives ready signal
- **WHEN** a Pi extension subscribes to `web-fetch:ready` before pi-web-fetch loads
- **AND** pi-web-fetch subsequently loads and emits `web-fetch:ready`
- **THEN** the Pi extension's handler SHALL be called, allowing it to register

### Requirement: Persistent registration listener
pi-web-fetch SHALL keep its `web-fetch:register` listener active for the entire session lifetime, not just during startup. This ensures that extensions registering at any point during the session are accepted.

#### Scenario: Registration after session fully started
- **WHEN** a Pi extension emits `web-fetch:register` after all `session_start` handlers have completed
- **THEN** pi-web-fetch SHALL still accept and register the extension

### Requirement: Extension priority order
The extension system SHALL check extensions in this priority order: Pi extensions (event bus) → local extensions → built-in extensions. Within each source, extensions SHALL be checked in registration order. The first matching extension wins.

#### Scenario: Pi extension overrides built-in
- **WHEN** a Pi extension registers a handler matching `github.com/*/*/blob/**`
- **AND** the built-in github-redirect extension also matches that pattern
- **THEN** the Pi extension's hooks SHALL be invoked, not the built-in's

#### Scenario: Local extension overrides built-in
- **WHEN** a local extension matches `docs.google.com/**`
- **AND** the built-in google-docs-redirect extension also matches
- **THEN** the local extension's hooks SHALL be invoked

#### Scenario: No extensions match
- **WHEN** no extension from any source matches the URL being fetched
- **THEN** the pipeline SHALL proceed with default behavior (no hooks invoked)

### Requirement: URL pattern matching via glob
Extension `matches` patterns SHALL be matched against the URL's hostname + pathname using glob syntax. The glob matching SHALL support `*` (single segment) and `**` (multiple segments) wildcards.

#### Scenario: Exact domain match
- **WHEN** an extension declares `matches: ["docs.google.com/**"]`
- **AND** the URL is `https://docs.google.com/document/d/abc123/edit`
- **THEN** the extension SHALL match

#### Scenario: Path-specific match
- **WHEN** an extension declares `matches: ["github.com/*/*/blob/**"]`
- **AND** the URL is `https://github.com/org/repo/blob/main/src/index.ts`
- **THEN** the extension SHALL match

#### Scenario: Path-specific non-match
- **WHEN** an extension declares `matches: ["github.com/*/*/blob/**"]`
- **AND** the URL is `https://github.com/org/repo/issues/42`
- **THEN** the extension SHALL NOT match

#### Scenario: Multiple patterns
- **WHEN** an extension declares `matches: ["github.com/*/*/blob/**", "github.com/*/*/tree/**"]`
- **AND** the URL is `https://github.com/org/repo/tree/main/src`
- **THEN** the extension SHALL match

### Requirement: Extension registration during session start
Built-in and local extensions SHALL be discovered, loaded, and registered during the `session_start` event, before emitting `web-fetch:ready`. Event bus registrations may arrive at any time during or after session start.

#### Scenario: Built-in and local extensions ready before ready signal
- **WHEN** `web-fetch:ready` is emitted
- **THEN** all built-in and local extensions SHALL already be loaded and available for URL matching

#### Scenario: Extension count logged
- **WHEN** extensions are loaded during session start
- **THEN** the system SHALL log the number of extensions loaded (built-in + local + event-bus)

### Requirement: Type exports for Pi extension authors
pi-web-fetch SHALL export the `WebFetchExtension`, `HookContext`, and `HookResult` types from its package so that separate Pi extensions can import them for type safety.

#### Scenario: Type import from pi-web-fetch
- **WHEN** a Pi extension author writes `import type { WebFetchExtension } from "pi-web-fetch"`
- **THEN** the import SHALL resolve to the correct type definition

#### Scenario: Type includes all hook signatures
- **WHEN** an extension author uses the `WebFetchExtension` type
- **THEN** it SHALL provide autocomplete and type checking for all four hook methods and their parameters
