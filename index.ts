import { spawn } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Text, Markdown } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { BrowserPool } from "./browser-pool.js";

// Re-export public types for extension authors
export type {
	WebFetchExtension,
	HookContext,
	HookResult,
	AfterFetchHookContext,
	AfterExtractHookContext,
	SummarizeHookContext,
	ToolContent,
} from "./types.js";

import type {
	WebFetchExtension,
	HookContext,
	HookResult,
	AfterFetchHookContext,
	AfterExtractHookContext,
	SummarizeHookContext,
} from "./types.js";
import { createHookContext } from "./types.js";
import { ExtensionRegistry } from "./registry.js";

// --- Config ---

interface WebFetchConfig {
	/** Model for LLM processing (e.g. "provider/model-id"). Defaults to the current session model. */
	model?: string;
	/** Thinking level for the sub-agent. Defaults to the current session thinking level. */
	thinkingLevel?: string;
	/** Custom directory path for local extensions. Defaults to ~/.pi/extensions/web-fetch/ */
	extensionsDir?: string;
}

const CONFIG_PATH = join(homedir(), ".pi", "agent", "web-fetch.json");

function loadConfig(): WebFetchConfig {
	try {
		const raw = readFileSync(CONFIG_PATH, "utf-8");
		return JSON.parse(raw) as WebFetchConfig;
	} catch {
		return {};
	}
}

const config: WebFetchConfig = loadConfig();

const registry = new ExtensionRegistry();
const MAX_BROWSER_TABS = 6; // Maximum concurrent browser tabs for parallel fetching
const BROWSER_IDLE_TIMEOUT_MS = 60_000; // Close browser after 60s idle
const browserPool = new BrowserPool({ maxTabs: MAX_BROWSER_TABS, idleTimeoutMs: BROWSER_IDLE_TIMEOUT_MS });

// --- Extension Loading ---

type NotifyFn = (message: string, level: "info" | "warning" | "error") => void;

/**
 * Load built-in extensions from the extensions/ directory relative to this file.
 */
async function loadBuiltInExtensions(notify: NotifyFn): Promise<void> {
	const thisDir = dirname(fileURLToPath(import.meta.url));
	const extensionsDir = join(thisDir, "extensions");

	if (!existsSync(extensionsDir)) {
		return;
	}

	const files = readdirSync(extensionsDir).filter(
		(f) => f.endsWith(".ts") || f.endsWith(".js"),
	);

	for (const file of files) {
		try {
			const modulePath = join(extensionsDir, file);
			const mod = await import(modulePath);
			const factory = mod.default;
			if (typeof factory !== "function") {
				notify(`web-fetch: built-in extension ${file} has no default export function, skipping`, "warning");
				continue;
			}
			const ext: WebFetchExtension = factory();
			if (!ext.name || !ext.matches) {
				notify(`web-fetch: built-in extension ${file} missing name or matches, skipping`, "warning");
				continue;
			}
			registry.addBuiltIn(ext);
		} catch (err: any) {
			notify(`web-fetch: failed to load built-in extension ${file}: ${err.message}`, "error");
		}
	}
}

/**
 * Load local extensions from a user directory.
 */
async function loadLocalExtensions(extensionsDir: string, notify: NotifyFn): Promise<void> {
	if (!existsSync(extensionsDir)) {
		return;
	}

	const files = readdirSync(extensionsDir).filter(
		(f) => f.endsWith(".ts") || f.endsWith(".js"),
	);

	for (const file of files) {
		try {
			const modulePath = join(extensionsDir, file);
			const mod = await import(modulePath);
			const factory = mod.default;
			if (typeof factory !== "function") {
				notify(`web-fetch: local extension ${file} has no default export function, skipping`, "warning");
				continue;
			}
			const ext: WebFetchExtension = factory();
			if (!ext.name || !ext.matches) {
				notify(`web-fetch: local extension ${file} missing name or matches, skipping`, "warning");
				continue;
			}
			registry.addLocal(ext);
		} catch (err: any) {
			notify(`web-fetch: failed to load local extension ${file}: ${err.message}`, "error");
		}
	}
}

/**
 * Set up event bus registration for Pi extensions.
 * Subscribes to web-fetch:register and validates incoming payloads.
 */
function setupEventBusRegistration(pi: ExtensionAPI): void {
	pi.events.on("web-fetch:register", (data: unknown) => {
		const ext = data as WebFetchExtension;
		if (!ext || typeof ext !== "object") {
			console.error("web-fetch: received invalid registration on web-fetch:register (not an object)");
			return;
		}
		if (!ext.name || !ext.matches || !Array.isArray(ext.matches)) {
			console.error("web-fetch: received registration missing required fields (name, matches)");
			return;
		}
		registry.addEventBus(ext);
	});
}

// --- Constants ---

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const PAGE_TIMEOUT_MS = 30_000; // 30 seconds
const CONTENT_SIZE_THRESHOLD = 50_000; // ~50KB — above this, summarize instead of returning raw

const CONTENT_GUARDRAILS = `Respond concisely using only the page content above.
- Keep direct quotes under 125 characters and always use quotation marks for exact wording.
- Outside of quotes, rephrase in your own words — never reproduce source text verbatim.
- Open-source code and documentation snippets are fine to include as-is.`;

const SUMMARIZE_PROMPT = `Summarize this page:
1. A 2-3 sentence overview of the page's purpose.
2. For each major section or heading, its name and a 1-2 sentence description.
3. End with: "To extract specific information, call web_fetch again with the same URL and a prompt. The page is cached so re-fetching is instant."

${CONTENT_GUARDRAILS}`;

// --- Cache ---

interface CacheEntry {
	content: string;
	timestamp: number;
}

const cache = new Map<string, CacheEntry>();

function getCached(url: string): string | null {
	const entry = cache.get(url);
	if (!entry) return null;
	if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
		cache.delete(url);
		return null;
	}
	return entry.content;
}

function setCache(url: string, content: string): void {
	cache.set(url, { content, timestamp: Date.now() });
}

function cleanupCache(): void {
	const now = Date.now();
	for (const [url, entry] of cache) {
		if (now - entry.timestamp > CACHE_TTL_MS) {
			cache.delete(url);
		}
	}
}

// --- URL Helpers ---

function validateAndNormalizeUrl(raw: string): { url: string; error?: undefined } | { url?: undefined; error: string } {
	// Strip leading @ (some models add it)
	const cleaned = raw.startsWith("@") ? raw.slice(1) : raw;

	let parsed: URL;
	try {
		parsed = new URL(cleaned);
	} catch {
		return { error: `Invalid URL: "${cleaned}". Please provide a fully-formed URL (e.g., https://example.com/page).` };
	}

	if (parsed.protocol === "http:") {
		parsed.protocol = "https:";
	}

	if (parsed.protocol !== "https:") {
		return { error: `Unsupported URL scheme: "${parsed.protocol}". Only HTTP and HTTPS URLs are supported.` };
	}

	return { url: parsed.toString() };
}

// --- Subprocess Helpers ---

function killProcess(proc: ReturnType<typeof spawn>): void {
	proc.kill("SIGTERM");
	setTimeout(() => {
		if (!proc.killed) proc.kill("SIGKILL");
	}, 5000);
}

// --- Python Runner Detection ---

interface PythonRunner {
	command: string;
	/** Arguments to build the full trafilatura invocation */
	trafilaturaArgs: () => string[];
	label: string;
}

/**
 * Python tool runners in priority order.
 * Each can run trafilatura in an ephemeral environment without permanent installation.
 *
 *  1. uvx           — fastest, ships with uv (uvx trafilatura ...)
 *  2. uv run --with — fallback if uvx alias is missing but uv is installed
 *  3. pipx run      — widely available, especially on Debian/Ubuntu
 *  4. pip-run       — niche but capable (pip-run trafilatura -- -m trafilatura ...)
 */
const PYTHON_RUNNERS: PythonRunner[] = [
	{
		command: "uvx",
		trafilaturaArgs: () => ["trafilatura", "--markdown", "--formatting"],
		label: "uvx (uv)",
	},
	{
		command: "uv",
		trafilaturaArgs: () => ["run", "--with", "trafilatura", "trafilatura", "--markdown", "--formatting"],
		label: "uv run",
	},
	{
		command: "pipx",
		trafilaturaArgs: () => ["run", "trafilatura", "--markdown", "--formatting"],
		label: "pipx",
	},
	{
		command: "pip-run",
		trafilaturaArgs: () => ["trafilatura", "--", "-m", "trafilatura", "--markdown", "--formatting"],
		label: "pip-run",
	},
];

let detectedRunner: PythonRunner | null = null;
let runnerDetectionDone = false;

async function detectPythonRunner(execFn: ExtensionAPI["exec"]): Promise<PythonRunner | null> {
	if (runnerDetectionDone) return detectedRunner;

	for (const runner of PYTHON_RUNNERS) {
		try {
			const result = await execFn(runner.command, ["--version"], { timeout: 5000 });
			if (result.code === 0) {
				detectedRunner = runner;
				runnerDetectionDone = true;
				return detectedRunner;
			}
		} catch {
			// not available, try next
		}
	}

	runnerDetectionDone = true;
	return null;
}

// --- Page Fetching ---

interface FetchResult {
	html: string;
	finalUrl: string;
}

interface RedirectResult {
	redirectedTo: string;
}

async function fetchPage(
	url: string,
	signal?: AbortSignal,
): Promise<{ ok: true; result: FetchResult } | { ok: true; redirect: RedirectResult } | { ok: false; error: string }> {
	let page: Awaited<ReturnType<typeof browserPool.acquire>> | null = null;

	try {
		if (signal?.aborted) return { ok: false, error: "Aborted" };

		page = await browserPool.acquire(signal);

		// Track redirects
		const requestUrl = new URL(url);
		let crossHostRedirect: string | null = null;

		page.on("response", (response) => {
			// Only track redirects for the main navigation request, not sub-resources
			// (scripts, images, analytics, etc. often redirect cross-host)
			if (!response.request().isNavigationRequest()) return;

			const status = response.status();
			if (status >= 300 && status < 400) {
				const location = response.headers()["location"];
				if (location) {
					try {
						const redirectUrl = new URL(location, url);
						if (redirectUrl.hostname !== requestUrl.hostname) {
							crossHostRedirect = redirectUrl.toString();
						}
					} catch {
						// ignore malformed redirect URLs
					}
				}
			}
		});

		try {
			await page.goto(url, {
				waitUntil: "networkidle2",
				timeout: PAGE_TIMEOUT_MS,
			});
		} catch (err: any) {
			if (signal?.aborted) return { ok: false, error: "Aborted" };
			if (err.name === "TimeoutError" || err.message?.includes("timeout")) {
				return { ok: false, error: `Page load timed out after ${PAGE_TIMEOUT_MS / 1000} seconds for URL: ${url}` };
			}
			return { ok: false, error: `Failed to load page: ${err.message}` };
		}

		// Check for cross-host redirect
		if (crossHostRedirect) {
			return { ok: true, redirect: { redirectedTo: crossHostRedirect } };
		}

		const html = await page.content();
		const finalUrl = page.url();

		return { ok: true, result: { html, finalUrl } };
	} catch (err: any) {
		if (signal?.aborted) return { ok: false, error: "Aborted" };
		return { ok: false, error: `Browser error: ${err.message}` };
	} finally {
		if (page) await browserPool.release(page);
	}
}

// --- Content Extraction ---

async function extractContent(
	html: string,
	signal?: AbortSignal,
): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
	if (signal?.aborted) return { ok: false, error: "Aborted" };

	if (!detectedRunner) {
		return { ok: false, error: "No Python tool runner found. Install one of: uv (recommended), pipx, or pip-run." };
	}

	const { command, args } = { command: detectedRunner.command, args: detectedRunner.trafilaturaArgs() };

	return new Promise((resolve) => {
		const proc = spawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		const onAbort = () => killProcess(proc);
		signal?.addEventListener("abort", onAbort, { once: true });

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			signal?.removeEventListener("abort", onAbort);

			if (signal?.aborted) {
				resolve({ ok: false, error: "Aborted" });
				return;
			}

			if (code !== 0) {
				resolve({ ok: false, error: `Trafilatura extraction failed (exit code ${code}): ${stderr.trim() || "(no error output)"}` });
				return;
			}

			const trimmed = stdout.trim();
			if (!trimmed) {
				resolve({ ok: false, error: "Trafilatura extracted no content from the page. The page may be empty or use a format that trafilatura cannot parse." });
				return;
			}

			resolve({ ok: true, markdown: trimmed });
		});

		proc.on("error", (err) => {
			signal?.removeEventListener("abort", onAbort);
			resolve({ ok: false, error: `Failed to run ${command} trafilatura: ${err.message}` });
		});

		// Pipe HTML to stdin
		proc.stdin.write(html);
		proc.stdin.end();
	});
}

// --- Sub-Agent ---

interface SubAgentResult {
	ok: true;
	response: string;
}

interface SubAgentError {
	ok: false;
	error: string;
}

async function runSubAgent(
	content: string,
	prompt: string,
	model: string,
	thinkingLevel: string,
	signal?: AbortSignal,
): Promise<SubAgentResult | SubAgentError> {
	if (signal?.aborted) return { ok: false, error: "Aborted" };

	const fullPrompt = `Web page content:\n---\n${content}\n---\n\n${prompt}`;

	return new Promise((resolve) => {
		const proc = spawn("pi", [
			"--mode", "json",
			"-p",
			"--no-session",
			"--no-tools",
			"--model", model,
			"--thinking", thinkingLevel,
			fullPrompt,
		], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		let buffer = "";
		let lastAssistantText = "";
		let stderr = "";

		const onAbort = () => killProcess(proc);
		signal?.addEventListener("abort", onAbort, { once: true });

		const processLine = (line: string) => {
			if (!line.trim()) return;
			try {
				const event = JSON.parse(line);
				if (event.type === "message_end" && event.message?.role === "assistant") {
					for (const part of event.message.content) {
						if (part.type === "text") {
							lastAssistantText = part.text;
						}
					}
				}
			} catch {
				// ignore non-JSON lines
			}
		};

		proc.stdout.on("data", (data) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) processLine(line);
		});

		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			signal?.removeEventListener("abort", onAbort);

			// Process any remaining buffer
			if (buffer.trim()) processLine(buffer);

			if (signal?.aborted) {
				resolve({ ok: false, error: "Aborted" });
				return;
			}

			if (lastAssistantText) {
				resolve({ ok: true, response: lastAssistantText });
			} else if (code !== 0) {
				resolve({ ok: false, error: `Sub-agent failed (exit code ${code}): ${stderr.trim() || "(no output)"}` });
			} else {
				resolve({ ok: false, error: "Sub-agent returned no response" });
			}
		});

		proc.on("error", (err) => {
			signal?.removeEventListener("abort", onAbort);
			resolve({ ok: false, error: `Failed to spawn pi sub-agent: ${err.message}` });
		});
	});
}

// --- Extension ---

export default function (pi: ExtensionAPI) {
	let cleanupInterval: ReturnType<typeof setInterval> | null = null;

	// Dependency check and extension loading on session start
	pi.on("session_start", async (_event, ctx) => {
		const runner = await detectPythonRunner(pi.exec.bind(pi));
		if (!runner) {
			ctx.ui.notify(
				"web_fetch: no Python tool runner found. Install one of: uv (recommended), pipx, or pip-run",
				"error",
			);
		}

		// 1. Subscribe to event bus registrations (persistent for session lifetime)
		setupEventBusRegistration(pi);

		// 2. Load built-in extensions
		await loadBuiltInExtensions(ctx.ui.notify.bind(ctx.ui));

		// 3. Load local extensions
		const localDir = config.extensionsDir || join(homedir(), ".pi", "extensions", "web-fetch");
		await loadLocalExtensions(localDir, ctx.ui.notify.bind(ctx.ui));

		// 4. Signal readiness to other Pi extensions
		pi.events.emit("web-fetch:ready", undefined);

		// Start cache cleanup interval
		cleanupInterval = setInterval(cleanupCache, CACHE_CLEANUP_INTERVAL_MS);
	});

	// Clean up on shutdown
	pi.on("session_shutdown", async () => {
		if (cleanupInterval) {
			clearInterval(cleanupInterval);
			cleanupInterval = null;
		}
		cache.clear();
		await browserPool.shutdown();
	});

	// Register the web_fetch tool
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description: [
			"Retrieves and extracts the main content of a web page as markdown.",
			"",
			"Include a 'prompt' parameter to have an LLM distill the page down to just the information you need — this saves significant context compared to ingesting raw page content.",
			"Without a prompt, the full extracted markdown is returned (or a structured overview if the page is large).",
			"",
			"When to use something else:",
			"- The gh CLI (via bash) for anything on GitHub — issues, PRs, repo contents, API calls.",
			"",
			"Behavior notes:",
			"- URLs must include the scheme (e.g. https://). Plain HTTP is silently upgraded to HTTPS.",
			"- Fetched content is held in a short-lived cache, so asking multiple questions about the same page is cheap.",
			"- Cross-host redirects are surfaced rather than followed — make a second request to the target URL.",
			"- No files or external state are modified by this tool.",
		].join("\n"),
		parameters: Type.Object({
			url: Type.String({ description: "Fully-formed URL to fetch (e.g., https://example.com/page)" }),
			prompt: Type.Optional(
				Type.String({
					description:
						"What information to extract from the page. Strongly recommended — the page content will be processed by a fast LLM and only relevant information returned. Omit only if you need the full raw content.",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			// Resolve model and thinking level: config file → current session
			const model = config.model || (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
			const thinkingLevel = config.thinkingLevel || pi.getThinkingLevel();
			// 1. Validate and normalize URL
			const urlResult = validateAndNormalizeUrl(params.url);
			if (urlResult.error) {
				return {
					content: [{ type: "text", text: urlResult.error }],
					isError: true,
				};
			}
			const url = urlResult.url;

			// Find matching extension (if any)
			const matchedExtension = registry.match(url);
			const hookCtx = createHookContext(url, { prompt: params.prompt, signal });

			// 2. Check cache (before hooks, since beforeFetch may short-circuit)
			const cached = getCached(url);
			if (cached) {
				onUpdate?.({ content: [{ type: "text", text: "Cache hit — processing..." }] });
				return await runProcess(cached, url, params.prompt, model, thinkingLevel, matchedExtension, hookCtx, signal, onUpdate);
			}

			// 3. beforeFetch hook — can short-circuit entire pipeline
			if (matchedExtension?.beforeFetch) {
				const hookResult = await matchedExtension.beforeFetch(hookCtx);
				if (hookResult) {
					return hookResult;
				}
			}

			// 4. Fetch page
			const fetchOuter = await runFetch(url, signal, onUpdate);
			if (fetchOuter.done) return fetchOuter.result;
			let html = fetchOuter.html;

			// 5. afterFetch hook — can replace HTML or short-circuit
			if (matchedExtension?.afterFetch) {
				const afterFetchCtx: AfterFetchHookContext = { ...hookCtx, html };
				const hookResult = await matchedExtension.afterFetch(afterFetchCtx);
				if (hookResult) {
					if ("content" in hookResult && Array.isArray(hookResult.content)) {
						// HookResult — short-circuit
						return hookResult as HookResult;
					}
					if ("html" in hookResult && typeof (hookResult as any).html === "string") {
						// HTML replacement
						html = (hookResult as { html: string }).html;
					}
				}
			}

			// 6. Extract content
			const extractOuter = await runExtract(html, signal, onUpdate);
			if (extractOuter.done) return extractOuter.result;
			let markdown = extractOuter.markdown;

			// 7. afterExtract hook — can replace markdown or short-circuit
			if (matchedExtension?.afterExtract) {
				const afterExtractCtx: AfterExtractHookContext = { ...hookCtx, markdown };
				const hookResult = await matchedExtension.afterExtract(afterExtractCtx);
				if (hookResult) {
					if (typeof hookResult === "string") {
						// String replacement
						markdown = hookResult;
					} else if ("content" in hookResult && Array.isArray(hookResult.content)) {
						// HookResult — short-circuit
						return hookResult as HookResult;
					}
				}
			}

			// 8. Store in cache
			setCache(url, markdown);

			// 9. Process and return (with summarize hook support)
			return await runProcess(markdown, url, params.prompt, model, thinkingLevel, matchedExtension, hookCtx, signal, onUpdate);
		},

		renderCall(args, theme) {
			const url = args.url || "...";
			const shortUrl = url.length > 70 ? url.slice(0, 70) + "..." : url;
			let text = theme.fg("toolTitle", theme.bold("web_fetch ")) + theme.fg("accent", shortUrl);
			if (args.prompt) {
				text += "  " + theme.fg("dim", "· " + args.prompt);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const isError = result.isError;
			const textContent = result.content[0];
			const text = textContent?.type === "text" ? textContent.text : "(no output)";

			if (isError) {
				return new Text("\n" + theme.fg("error", "✗ ") + theme.fg("error", text), 0, 0);
			}

			const icon = theme.fg("success", "✓ ");
			if (expanded) {
				return new Markdown("\n" + text, 0, 0, getMarkdownTheme());
			}

			// Collapsed: show first few lines
			const lines = text.split("\n");
			const preview = lines.slice(0, 5).join("\n");
			const suffix = lines.length > 5 ? theme.fg("muted", `\n... (${lines.length - 5} more lines, Ctrl+O to expand)`) : "";
			return new Text("\n" + icon + preview + suffix, 0, 0);
		},
	});

	// --- Pipeline Stage Functions ---

	/**
	 * Stage: Fetch page via puppeteer.
	 * Returns either a done result (error/redirect) or the HTML to continue processing.
	 */
	async function runFetch(
		url: string,
		signal?: AbortSignal,
		onUpdate?: Parameters<Parameters<typeof pi.registerTool>[0]["execute"]>[3],
	): Promise<{ done: true; result: any } | { done: false; html: string }> {
		onUpdate?.({ content: [{ type: "text", text: `Fetching ${url}...` }] });

		const fetchResult = await fetchPage(url, signal);
		if (!fetchResult.ok) {
			return {
				done: true,
				result: {
					content: [{ type: "text", text: (fetchResult as { ok: false; error: string }).error }],
					isError: true,
				},
			};
		}

		// Handle cross-host redirect
		if ("redirect" in fetchResult) {
			const redirectUrl = (fetchResult as { ok: true; redirect: RedirectResult }).redirect.redirectedTo;
			return {
				done: true,
				result: {
					content: [
						{
							type: "text",
							text: `The URL redirected to a different host: ${redirectUrl}\n\nTo fetch the content, make a new web_fetch call with this URL: ${redirectUrl}`,
						},
					],
				},
			};
		}

		return { done: false, html: fetchResult.result.html };
	}

	/**
	 * Stage: Extract content from HTML via trafilatura.
	 * Returns either a done result (error) or the markdown to continue processing.
	 */
	async function runExtract(
		html: string,
		signal?: AbortSignal,
		onUpdate?: Parameters<Parameters<typeof pi.registerTool>[0]["execute"]>[3],
	): Promise<{ done: true; result: any } | { done: false; markdown: string }> {
		onUpdate?.({ content: [{ type: "text", text: "Extracting content..." }] });

		const extractResult = await extractContent(html, signal);
		if (!extractResult.ok) {
			return {
				done: true,
				result: {
					content: [{ type: "text", text: (extractResult as { ok: false; error: string }).error }],
					isError: true,
				},
			};
		}

		return { done: false, markdown: extractResult.markdown };
	}

	/**
	 * Stage: Process extracted content — summarize hook, sub-agent, or raw return.
	 */
	async function runProcess(
		markdown: string,
		url: string,
		prompt: string | undefined,
		model: string | undefined,
		thinkingLevel: string,
		matchedExtension: WebFetchExtension | null,
		hookCtx: HookContext,
		signal?: AbortSignal,
		onUpdate?: Parameters<Parameters<typeof pi.registerTool>[0]["execute"]>[3],
	) {
		// Check summarize hook before sub-agent
		if (matchedExtension?.summarize) {
			const summarizeCtx: SummarizeHookContext = { ...hookCtx, markdown };
			const hookResult = await matchedExtension.summarize(summarizeCtx);
			if (hookResult) {
				return hookResult;
			}
		}

		// Prompted path — use sub-agent if model available
		if (prompt && model) {
			onUpdate?.({ content: [{ type: "text", text: "Processing with LLM..." }] });

			const agentResult = await runSubAgent(markdown, `${prompt}\n\n${CONTENT_GUARDRAILS}`, model, thinkingLevel, signal);
			if (agentResult.ok) {
				return {
					content: [{ type: "text", text: agentResult.response }],
				};
			}

			// Fallback: return raw markdown with truncation + error note
			const truncation = truncateHead(markdown, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			let fallbackText = truncation.content;
			if (truncation.truncated) {
				fallbackText += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
			}
			fallbackText += `\n\n⚠️ LLM processing failed: ${(agentResult as SubAgentError).error}. Returning raw extracted content instead.`;

			return {
				content: [{ type: "text", text: fallbackText }],
			};
		}

		// No prompt — check content size
		if (markdown.length <= CONTENT_SIZE_THRESHOLD) {
			// Short content: return directly
			return {
				content: [{ type: "text", text: markdown }],
			};
		}

		// Large content: summarize via sub-agent if model available, otherwise truncate
		if (!model) {
			const truncation = truncateHead(markdown, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			let text = truncation.content;
			if (truncation.truncated) {
				text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
			}
			return { content: [{ type: "text", text }] };
		}

		onUpdate?.({ content: [{ type: "text", text: "Page content is large — generating summary..." }] });

		const summaryResult = await runSubAgent(markdown, SUMMARIZE_PROMPT, model, thinkingLevel, signal);
		if (summaryResult.ok) {
			return {
				content: [{ type: "text", text: summaryResult.response }],
			};
		}

		// Fallback: return truncated raw markdown
		const truncation = truncateHead(markdown, {
			maxLines: DEFAULT_MAX_LINES,
			maxBytes: DEFAULT_MAX_BYTES,
		});

		let fallbackText = truncation.content;
		if (truncation.truncated) {
			fallbackText += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
		}
		fallbackText += `\n\n⚠️ Could not generate summary: ${(summaryResult as SubAgentError).error}. Returning truncated raw content. Consider calling web_fetch again with a prompt to extract specific information.`;

		return {
			content: [{ type: "text", text: fallbackText }],
		};
	}
}
