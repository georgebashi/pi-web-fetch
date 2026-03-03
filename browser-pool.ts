/**
 * Browser pool: manages a shared Puppeteer browser instance with multiple tabs.
 *
 * Instead of launching a new browser per fetch, we maintain a single browser
 * and open new tabs (pages) for each concurrent request. This avoids the ~1-2s
 * overhead of launching Chrome per request and allows true parallel page loading.
 *
 * Lifecycle:
 *   - Browser is lazily launched on first acquire()
 *   - Each acquire() opens a new tab (up to maxTabs concurrently)
 *   - release() closes the tab and returns it to the pool
 *   - Browser auto-closes after idleTimeoutMs of no active tabs
 *   - shutdown() immediately closes everything
 */
import puppeteer, { type Browser, type Page } from "puppeteer";

export interface BrowserPoolOptions {
	/** Maximum concurrent tabs. Excess requests queue until a tab is available. Default: 6. */
	maxTabs?: number;
	/** Close browser after this many ms with no active tabs. Default: 60_000. */
	idleTimeoutMs?: number;
}

const DEFAULT_MAX_TABS = 6;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

export class BrowserPool {
	private browser: Browser | null = null;
	private launching: Promise<Browser> | null = null;
	private activeTabs = 0;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly maxTabs: number;
	private readonly idleTimeoutMs: number;
	private waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
	private closed = false;

	constructor(options?: BrowserPoolOptions) {
		this.maxTabs = options?.maxTabs ?? DEFAULT_MAX_TABS;
		this.idleTimeoutMs = options?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
	}

	/**
	 * Acquire a new browser tab. Launches the browser if needed.
	 * If maxTabs are in use, waits until one is released.
	 * The returned page must be released via release() when done.
	 */
	async acquire(signal?: AbortSignal): Promise<Page> {
		if (this.closed) throw new Error("BrowserPool is shut down");
		if (signal?.aborted) throw new Error("Aborted");

		// Wait for a slot if at capacity
		if (this.activeTabs >= this.maxTabs) {
			await this.waitForSlot(signal);
		}

		// Cancel idle shutdown since we're about to use the browser
		this.clearIdleTimer();

		const browser = await this.ensureBrowser();
		this.activeTabs++;

		try {
			const page = await browser.newPage();
			return page;
		} catch (err) {
			this.activeTabs--;
			this.scheduleIdleCheck();
			throw err;
		}
	}

	/**
	 * Release a tab back to the pool. Closes the page and allows waiting requests to proceed.
	 */
	async release(page: Page): Promise<void> {
		try {
			await page.close();
		} catch {
			// Page may already be closed (e.g. browser crashed)
		}
		this.activeTabs = Math.max(0, this.activeTabs - 1);

		// Wake up next waiter
		const next = this.waitQueue.shift();
		if (next) {
			next.resolve();
		} else {
			this.scheduleIdleCheck();
		}
	}

	/**
	 * Immediately close the browser and reject any waiting requests.
	 */
	async shutdown(): Promise<void> {
		this.closed = true;
		this.clearIdleTimer();

		// Reject all waiters
		for (const waiter of this.waitQueue) {
			waiter.reject(new Error("BrowserPool is shutting down"));
		}
		this.waitQueue = [];

		await this.closeBrowser();
	}

	/** Number of currently active tabs. */
	get activeCount(): number {
		return this.activeTabs;
	}

	/** Number of requests waiting for a tab slot. */
	get waitingCount(): number {
		return this.waitQueue.length;
	}

	/** Whether the browser is currently running. */
	get isRunning(): boolean {
		return this.browser !== null;
	}

	// --- Internals ---

	private async ensureBrowser(): Promise<Browser> {
		if (this.browser) return this.browser;

		// Deduplicate concurrent launches
		if (this.launching) return this.launching;

		this.launching = puppeteer.launch({
			headless: true,
			executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
		});

		try {
			this.browser = await this.launching;

			// If the browser disconnects unexpectedly, clean up
			this.browser.on("disconnected", () => {
				this.browser = null;
				this.activeTabs = 0;
				// Reject all waiters since the browser is gone
				for (const waiter of this.waitQueue) {
					waiter.reject(new Error("Browser disconnected unexpectedly"));
				}
				this.waitQueue = [];
			});

			return this.browser;
		} finally {
			this.launching = null;
		}
	}

	private async closeBrowser(): Promise<void> {
		const browser = this.browser;
		this.browser = null;
		this.activeTabs = 0;

		if (browser) {
			try {
				await browser.close();
			} catch {
				// Already closed
			}
		}
	}

	private waitForSlot(signal?: AbortSignal): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (signal?.aborted) {
				reject(new Error("Aborted"));
				return;
			}

			const entry = { resolve, reject };
			this.waitQueue.push(entry);

			// If the signal aborts while we're waiting, remove from queue and reject
			const onAbort = () => {
				const idx = this.waitQueue.indexOf(entry);
				if (idx !== -1) {
					this.waitQueue.splice(idx, 1);
				}
				reject(new Error("Aborted"));
			};
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	private scheduleIdleCheck(): void {
		if (this.activeTabs > 0 || this.waitQueue.length > 0) return;
		this.clearIdleTimer();
		this.idleTimer = setTimeout(() => {
			if (this.activeTabs === 0 && !this.closed) {
				this.closeBrowser();
			}
		}, this.idleTimeoutMs);
	}

	private clearIdleTimer(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
	}
}
