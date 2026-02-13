# pi-web-fetch

A [pi](https://github.com/badlogic/pi-mono) extension that fetches web pages via headless Chrome, extracts main content via [trafilatura](https://trafilatura.readthedocs.io/), and optionally processes the content with an LLM to answer questions.

## Features

- **`web_fetch` tool** — registered in pi's tool system, callable by the LLM
- **Headless Chrome** — handles JavaScript-rendered pages via puppeteer
- **Content extraction** — strips boilerplate (nav, ads, footers) using trafilatura, outputs clean markdown
- **LLM processing** — optionally answers questions about page content via a pi sub-agent
- **Smart large-page handling** — when content is too large and no prompt is given, generates a structured summary with section descriptions
- **15-minute cache** — avoids redundant fetches; enables summarize-then-drill-down workflows
- **Redirect detection** — cross-host redirects are reported to the LLM for explicit follow-up
- **HTTP→HTTPS auto-upgrade**

## Prerequisites

- [pi](https://github.com/badlogic/pi-mono) coding agent
- A Python tool runner for trafilatura (auto-detected in priority order):
  1. [uv](https://docs.astral.sh/uv/) (`uvx`) — fastest, recommended
  2. `uv run` — fallback if `uvx` alias is missing
  3. [pipx](https://pipx.pypa.io/) — widely available on Debian/Ubuntu
  4. [pip-run](https://github.com/jaraco/pip-run) — niche fallback
- Node.js 18+

## Installation

```bash
git clone <this-repo>
cd pi-web-fetch
npm install
```

> **Note:** `npm install` will download puppeteer's bundled Chromium (~300MB). If you already have Chrome/Chromium installed, you can set `PUPPETEER_EXECUTABLE_PATH` to skip the download:
> ```bash
> export PUPPETEER_EXECUTABLE_PATH=/path/to/chrome
> ```

> **Note:** The first time `web_fetch` runs, `uvx` will download the trafilatura package (~10MB). Subsequent runs use the cached environment and are fast.

### Add to pi

Add the extension path to your pi settings (`~/.pi/agent/settings.json`):

```json
{
  "extensions": [
    "/path/to/pi-web-fetch"
  ]
}
```

Or use the `-e` flag for quick testing:

```bash
pi -e /path/to/pi-web-fetch
```

## Usage

The extension registers a `web_fetch` tool. The LLM will use it automatically when it needs to fetch web content.

**With a prompt (recommended):**
> Fetch https://docs.example.com/api and tell me what authentication methods are supported.

**Without a prompt (full content):**
> Fetch the content of https://example.com/changelog

## Configuration

Create `~/.pi/agent/web-fetch.json` to override the sub-agent model and thinking level:

```json
{
  "model": "provider/model-id",
  "thinkingLevel": "medium"
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `model` | Current session model | Model for LLM content processing |
| `thinkingLevel` | Current session thinking level | Thinking level for the sub-agent |

Without a config file, the extension uses whatever model and thinking level the current session is using. The config is reloaded on each `/reload`.

## License

MIT
