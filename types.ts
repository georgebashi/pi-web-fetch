// --- Extension Types ---
// Public API for pi-web-fetch extension authors

/**
 * Content block in a tool result (matches Pi's content types).
 */
export interface TextContent {
	type: "text";
	text: string;
}

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export type ToolContent = TextContent | ImageContent;

/**
 * Result returned by hooks to short-circuit or replace pipeline output.
 */
export interface HookResult {
	content: ToolContent[];
	isError?: boolean;
}

/**
 * Context passed to every hook function.
 */
export interface HookContext {
	/** Normalized URL (always https://) */
	url: string;
	/** Parsed URL object */
	parsedUrl: URL;
	/** User's prompt, if provided */
	prompt?: string;
	/** Abort signal for cancellation */
	signal?: AbortSignal;
	/**
	 * Helper to create a redirect/rejection result.
	 * Returns a HookResult with the message as text content.
	 */
	redirect(message: string): HookResult;
}

/**
 * Context for the afterFetch hook — includes fetched HTML.
 */
export interface AfterFetchHookContext extends HookContext {
	html: string;
}

/**
 * Context for the afterExtract hook — includes extracted markdown.
 */
export interface AfterExtractHookContext extends HookContext {
	markdown: string;
}

/**
 * Context for the summarize hook — includes markdown and optional prompt.
 */
export interface SummarizeHookContext extends HookContext {
	markdown: string;
}

/**
 * A web-fetch extension that handles site-specific fetch behavior.
 *
 * Extensions are modules whose default export is a factory function returning
 * a WebFetchExtension object. The same interface is used for built-in, local,
 * and event-bus extensions.
 *
 * @example
 * ```typescript
 * import type { WebFetchExtension } from "pi-web-fetch";
 *
 * export default function (): WebFetchExtension {
 *   return {
 *     name: "my-handler",
 *     matches: ["example.com/**"],
 *     async beforeFetch(ctx) {
 *       return ctx.redirect("Use a different tool for this site.");
 *     },
 *   };
 * }
 * ```
 */
export interface WebFetchExtension {
	/** Unique name for the extension */
	name: string;
	/** Human-readable description */
	description?: string;
	/**
	 * URL glob patterns to match against hostname + pathname.
	 * Uses picomatch syntax: `*` matches a single segment, `**` matches multiple.
	 * @example ["github.com/​*​/​*​/blob/**", "docs.google.com/**"]
	 */
	matches: string[];

	/**
	 * Called after URL validation but before fetching.
	 * Return a HookResult to short-circuit the entire pipeline.
	 * Return void to continue with normal fetching.
	 */
	beforeFetch?(ctx: HookContext): Promise<HookResult | void>;

	/**
	 * Called after HTML is fetched via puppeteer.
	 * Return `{ html: string }` to replace the fetched HTML before extraction.
	 * Return a HookResult to short-circuit remaining pipeline.
	 * Return void to continue with the original HTML.
	 */
	afterFetch?(ctx: AfterFetchHookContext): Promise<HookResult | { html: string } | void>;

	/**
	 * Called after content is extracted to markdown by trafilatura.
	 * Return a string to replace the extracted markdown.
	 * Return a HookResult to short-circuit remaining pipeline.
	 * Return void to keep the original markdown.
	 */
	afterExtract?(ctx: AfterExtractHookContext): Promise<HookResult | string | void>;

	/**
	 * Called before sub-agent summarization.
	 * Return a HookResult to replace the default sub-agent processing.
	 * Return void to proceed with normal summarization.
	 */
	summarize?(ctx: SummarizeHookContext): Promise<HookResult | void>;
}

/**
 * Create a HookContext for the given URL and options.
 * Used internally by pi-web-fetch; exported for testing.
 */
export function createHookContext(
	url: string,
	options?: { prompt?: string; signal?: AbortSignal },
): HookContext {
	return {
		url,
		parsedUrl: new URL(url),
		prompt: options?.prompt,
		signal: options?.signal,
		redirect(message: string): HookResult {
			return {
				content: [{ type: "text", text: message }],
			};
		},
	};
}
