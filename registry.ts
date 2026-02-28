/**
 * Extension registry and URL pattern matching.
 * Extracted for testability — used by index.ts at runtime.
 */
import picomatch from "picomatch";
import type { WebFetchExtension } from "./types.js";

/**
 * Match a URL against a list of extensions, returning the first match.
 * Extracts hostname + pathname from the URL and matches against extension glob patterns.
 */
export function matchExtension(url: string, extensions: WebFetchExtension[]): WebFetchExtension | null {
	let hostAndPath: string;
	try {
		const parsed = new URL(url);
		hostAndPath = parsed.hostname + parsed.pathname;
	} catch {
		return null;
	}

	for (const ext of extensions) {
		for (const pattern of ext.matches) {
			if (picomatch.isMatch(hostAndPath, pattern)) {
				return ext;
			}
		}
	}
	return null;
}

/**
 * Holds extensions from three sources in priority order:
 * event-bus (Pi extensions) → local → built-in.
 * The match() method searches in this priority order, returning the first match.
 */
export class ExtensionRegistry {
	private eventBus: WebFetchExtension[] = [];
	private local: WebFetchExtension[] = [];
	private builtIn: WebFetchExtension[] = [];

	addEventBus(ext: WebFetchExtension): void {
		this.eventBus.push(ext);
	}

	addLocal(ext: WebFetchExtension): void {
		this.local.push(ext);
	}

	addBuiltIn(ext: WebFetchExtension): void {
		this.builtIn.push(ext);
	}

	/**
	 * Find the first extension matching the given URL.
	 * Searches in priority order: event-bus → local → built-in.
	 */
	match(url: string): WebFetchExtension | null {
		return (
			matchExtension(url, this.eventBus) ||
			matchExtension(url, this.local) ||
			matchExtension(url, this.builtIn)
		);
	}

	/** Total number of registered extensions across all sources. */
	get count(): number {
		return this.eventBus.length + this.local.length + this.builtIn.length;
	}

	/** Counts per source for logging. */
	get counts(): { eventBus: number; local: number; builtIn: number } {
		return {
			eventBus: this.eventBus.length,
			local: this.local.length,
			builtIn: this.builtIn.length,
		};
	}
}
