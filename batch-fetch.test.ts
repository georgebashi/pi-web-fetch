import { describe, it, expect } from "vitest";
import { formatBatchResults, MAX_BATCH_SIZE } from "./index.js";

// --- helpers ---

function getText(result: { content: Array<{ type: string; text: string }> }): string {
	return result.content[0].text;
}

function fulfilled(value: any): PromiseSettledResult<any> {
	return { status: "fulfilled", value };
}

function rejected(reason: any): PromiseSettledResult<any> {
	return { status: "rejected", reason };
}

function okResult(text: string) {
	return { content: [{ type: "text", text }] };
}

function errorResult(text: string) {
	return { content: [{ type: "text", text }], isError: true };
}

// --- MAX_BATCH_SIZE ---

describe("MAX_BATCH_SIZE", () => {
	it("is 10", () => {
		expect(MAX_BATCH_SIZE).toBe(10);
	});
});

// --- formatBatchResults ---

describe("formatBatchResults", () => {
	describe("all pages succeed", () => {
		it("returns inner result directly for single page", () => {
			const pages = [{ url: "https://example.com" }];
			const results = [fulfilled(okResult("Hello world"))];

			const result = formatBatchResults(pages, results);
			const text = getText(result);

			// Single page: no batch header, just the raw content
			expect(text).toBe("Hello world");
		});

		it("formats multiple page results with correct indexing", () => {
			const pages = [
				{ url: "https://a.com" },
				{ url: "https://b.com" },
				{ url: "https://c.com" },
			];
			const results = [
				fulfilled(okResult("Content A")),
				fulfilled(okResult("Content B")),
				fulfilled(okResult("Content C")),
			];

			const result = formatBatchResults(pages, results);
			const text = getText(result);

			expect(text).toContain("--- [1/3] https://a.com ---");
			expect(text).toContain("Content A");
			expect(text).toContain("--- [2/3] https://b.com ---");
			expect(text).toContain("Content B");
			expect(text).toContain("--- [3/3] https://c.com ---");
			expect(text).toContain("Content C");
		});

		it("preserves request order regardless of result content", () => {
			const pages = [
				{ url: "https://first.com" },
				{ url: "https://second.com" },
			];
			const results = [
				fulfilled(okResult("First content")),
				fulfilled(okResult("Second content")),
			];

			const result = formatBatchResults(pages, results);
			const text = getText(result);

			const firstIdx = text.indexOf("--- [1/2] https://first.com ---");
			const secondIdx = text.indexOf("--- [2/2] https://second.com ---");
			expect(firstIdx).toBeLessThan(secondIdx);
		});

		it("returns a single content block", () => {
			const pages = [{ url: "https://a.com" }, { url: "https://b.com" }];
			const results = [
				fulfilled(okResult("A")),
				fulfilled(okResult("B")),
			];

			const result = formatBatchResults(pages, results);
			expect(result.content).toHaveLength(1);
			expect(result.content[0].type).toBe("text");
		});
	});

	describe("mixed success and failure", () => {
		it("includes error messages inline for failed pages", () => {
			const pages = [
				{ url: "https://good.com" },
				{ url: "https://bad.com" },
				{ url: "https://also-good.com" },
			];
			const results = [
				fulfilled(okResult("Good content")),
				fulfilled(errorResult("Page load timed out")),
				fulfilled(okResult("Also good content")),
			];

			const result = formatBatchResults(pages, results);
			const text = getText(result);

			expect(text).toContain("--- [1/3] https://good.com ---");
			expect(text).toContain("Good content");
			expect(text).toContain("--- [2/3] https://bad.com ---");
			expect(text).toContain("Error: Page load timed out");
			expect(text).toContain("--- [3/3] https://also-good.com ---");
			expect(text).toContain("Also good content");
		});

		it("handles rejected promises (unexpected errors)", () => {
			const pages = [
				{ url: "https://good.com" },
				{ url: "https://crash.com" },
			];
			const results = [
				fulfilled(okResult("Works fine")),
				rejected(new Error("Unexpected crash")),
			];

			const result = formatBatchResults(pages, results);
			const text = getText(result);

			expect(text).toContain("Works fine");
			expect(text).toContain("Error: Unexpected crash");
		});

		it("returns error result directly for single rejected page", () => {
			const pages = [{ url: "https://crash.com" }];
			const results = [rejected("some string error")];

			const result = formatBatchResults(pages, results);
			const text = getText(result);

			expect(text).toContain("Error: some string error");
			expect(result.isError).toBe(true);
		});
	});

	describe("result ordering", () => {
		it("always returns results in original request order", () => {
			const pages = [
				{ url: "https://slow.com" },
				{ url: "https://fast.com" },
				{ url: "https://medium.com" },
			];
			// Even if fast completed first, results array matches pages order
			const results = [
				fulfilled(okResult("Slow content")),
				fulfilled(okResult("Fast content")),
				fulfilled(okResult("Medium content")),
			];

			const result = formatBatchResults(pages, results);
			const text = getText(result);

			const lines = text.split("\n");
			const headers = lines.filter(l => l.startsWith("--- ["));

			expect(headers[0]).toBe("--- [1/3] https://slow.com ---");
			expect(headers[1]).toBe("--- [2/3] https://fast.com ---");
			expect(headers[2]).toBe("--- [3/3] https://medium.com ---");
		});
	});

	describe("edge cases", () => {
		it("handles empty content in single-page result", () => {
			const pages = [{ url: "https://empty.com" }];
			const results = [fulfilled({ content: [{ type: "text", text: "" }] })];

			const result = formatBatchResults(pages, results);
			// Single page passthrough — returns inner result directly
			expect(result.content[0].text).toBe("");
		});

		it("handles missing content array in single-page result", () => {
			const pages = [{ url: "https://broken.com" }];
			const results = [fulfilled({ content: [] })];

			const result = formatBatchResults(pages, results);
			// Single page passthrough — returns inner result directly
			expect(result.content).toHaveLength(0);
		});

		it("returns content directly for single page with prompt", () => {
			const pages = [{ url: "https://example.com", prompt: "Get the title" }];
			const results = [fulfilled(okResult("Title: Example"))];

			const result = formatBatchResults(pages, results);
			const text = getText(result);

			// Single page passthrough — content returned directly
			expect(text).toBe("Title: Example");
		});
	});
});
