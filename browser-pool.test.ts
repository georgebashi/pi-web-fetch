import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BrowserPool } from "./browser-pool.js";

// We mock puppeteer so tests run fast without a real browser
vi.mock("puppeteer", () => {
	const mockPage = () => ({
		close: vi.fn().mockResolvedValue(undefined),
		goto: vi.fn().mockResolvedValue(undefined),
		content: vi.fn().mockResolvedValue("<html></html>"),
		url: vi.fn().mockReturnValue("https://example.com"),
		on: vi.fn(),
	});

	const mockBrowser = () => {
		const browser = {
			newPage: vi.fn().mockImplementation(async () => mockPage()),
			close: vi.fn().mockResolvedValue(undefined),
			on: vi.fn(),
		};
		return browser;
	};

	return {
		default: {
			launch: vi.fn().mockImplementation(async () => mockBrowser()),
		},
	};
});

describe("BrowserPool", () => {
	let pool: BrowserPool;

	afterEach(async () => {
		if (pool) await pool.shutdown();
	});

	it("starts with no active tabs and not running", () => {
		pool = new BrowserPool();
		expect(pool.activeCount).toBe(0);
		expect(pool.waitingCount).toBe(0);
		expect(pool.isRunning).toBe(false);
	});

	it("acquires a page and reports active tab", async () => {
		pool = new BrowserPool();
		const page = await pool.acquire();
		expect(page).toBeDefined();
		expect(pool.activeCount).toBe(1);
		expect(pool.isRunning).toBe(true);

		await pool.release(page);
		expect(pool.activeCount).toBe(0);
	});

	it("reuses the same browser for multiple acquires", async () => {
		const puppeteer = (await import("puppeteer")).default;
		const launchCountBefore = vi.mocked(puppeteer.launch).mock.calls.length;
		pool = new BrowserPool();

		const page1 = await pool.acquire();
		const page2 = await pool.acquire();
		expect(pool.activeCount).toBe(2);

		// Only one additional browser.launch call for both acquires
		expect(puppeteer.launch).toHaveBeenCalledTimes(launchCountBefore + 1);

		await pool.release(page1);
		await pool.release(page2);
	});

	it("acquires up to maxTabs concurrently", async () => {
		pool = new BrowserPool({ maxTabs: 3 });

		const pages = await Promise.all([
			pool.acquire(),
			pool.acquire(),
			pool.acquire(),
		]);
		expect(pool.activeCount).toBe(3);

		for (const page of pages) {
			await pool.release(page);
		}
		expect(pool.activeCount).toBe(0);
	});

	it("queues requests when at maxTabs", async () => {
		pool = new BrowserPool({ maxTabs: 2 });

		const page1 = await pool.acquire();
		const page2 = await pool.acquire();
		expect(pool.activeCount).toBe(2);

		// Third acquire should block
		let page3Resolved = false;
		const page3Promise = pool.acquire().then((p) => {
			page3Resolved = true;
			return p;
		});

		// Give microtasks a chance to run
		await new Promise((r) => setTimeout(r, 10));
		expect(page3Resolved).toBe(false);
		expect(pool.waitingCount).toBe(1);

		// Release one — should unblock the waiter
		await pool.release(page1);
		const page3 = await page3Promise;
		expect(page3Resolved).toBe(true);
		expect(pool.activeCount).toBe(2);

		await pool.release(page2);
		await pool.release(page3);
	});

	it("respects abort signal when waiting for a slot", async () => {
		pool = new BrowserPool({ maxTabs: 1 });
		const page = await pool.acquire();

		const controller = new AbortController();
		const acquirePromise = pool.acquire(controller.signal);

		expect(pool.waitingCount).toBe(1);

		controller.abort();
		await expect(acquirePromise).rejects.toThrow("Aborted");
		expect(pool.waitingCount).toBe(0);

		await pool.release(page);
	});

	it("respects abort signal on acquire when already aborted", async () => {
		pool = new BrowserPool();
		const controller = new AbortController();
		controller.abort();

		await expect(pool.acquire(controller.signal)).rejects.toThrow("Aborted");
	});

	it("throws on acquire after shutdown", async () => {
		pool = new BrowserPool();
		await pool.shutdown();

		await expect(pool.acquire()).rejects.toThrow("shut down");
	});

	it("shutdown rejects waiting requests", async () => {
		pool = new BrowserPool({ maxTabs: 1 });
		const page = await pool.acquire();

		const waitingPromise = pool.acquire();
		expect(pool.waitingCount).toBe(1);

		await pool.shutdown();
		await expect(waitingPromise).rejects.toThrow("shutting down");

		// page release after shutdown should not throw
		await pool.release(page);
	});

	it("handles release of already-closed page gracefully", async () => {
		pool = new BrowserPool();
		const page = await pool.acquire();

		// Simulate page.close() throwing
		(page.close as any).mockRejectedValueOnce(new Error("Already closed"));

		// Should not throw
		await pool.release(page);
		expect(pool.activeCount).toBe(0);
	});

	it("idle timeout closes browser after no activity", async () => {
		pool = new BrowserPool({ idleTimeoutMs: 50 });
		const page = await pool.acquire();
		expect(pool.isRunning).toBe(true);

		await pool.release(page);

		// Wait for idle timeout
		await new Promise((r) => setTimeout(r, 100));
		expect(pool.isRunning).toBe(false);
	});

	it("parallel fetches share the same browser", async () => {
		const puppeteer = (await import("puppeteer")).default;
		vi.mocked(puppeteer.launch).mockClear();

		pool = new BrowserPool({ maxTabs: 4 });

		// Simulate 4 parallel fetches
		const pages = await Promise.all([
			pool.acquire(),
			pool.acquire(),
			pool.acquire(),
			pool.acquire(),
		]);

		// All share one browser launch
		expect(puppeteer.launch).toHaveBeenCalledTimes(1);
		expect(pool.activeCount).toBe(4);

		// Release all
		await Promise.all(pages.map((p) => pool.release(p)));
		expect(pool.activeCount).toBe(0);
	});

	it("wakes waiters in FIFO order", async () => {
		pool = new BrowserPool({ maxTabs: 1 });
		const page1 = await pool.acquire();

		const order: number[] = [];
		const p2 = pool.acquire().then((p) => { order.push(2); return p; });
		const p3 = pool.acquire().then((p) => { order.push(3); return p; });

		expect(pool.waitingCount).toBe(2);

		await pool.release(page1);
		const page2 = await p2;

		await pool.release(page2);
		const page3 = await p3;

		expect(order).toEqual([2, 3]);

		await pool.release(page3);
	});
});
