import { describe, it, expect } from "vitest";
import { createHookContext } from "./types.js";
import type { WebFetchExtension, HookResult } from "./types.js";

describe("createHookContext", () => {
	it("creates context with normalized URL", () => {
		const ctx = createHookContext("https://example.com/page");
		expect(ctx.url).toBe("https://example.com/page");
		expect(ctx.parsedUrl.hostname).toBe("example.com");
		expect(ctx.parsedUrl.pathname).toBe("/page");
	});

	it("includes prompt when provided", () => {
		const ctx = createHookContext("https://example.com", { prompt: "What is this?" });
		expect(ctx.prompt).toBe("What is this?");
	});

	it("prompt is undefined when not provided", () => {
		const ctx = createHookContext("https://example.com");
		expect(ctx.prompt).toBeUndefined();
	});

	it("includes signal when provided", () => {
		const controller = new AbortController();
		const ctx = createHookContext("https://example.com", { signal: controller.signal });
		expect(ctx.signal).toBe(controller.signal);
		expect(ctx.signal!.aborted).toBe(false);
	});

	it("signal reflects aborted state", () => {
		const controller = new AbortController();
		const ctx = createHookContext("https://example.com", { signal: controller.signal });
		controller.abort();
		expect(ctx.signal!.aborted).toBe(true);
	});
});

describe("redirect helper", () => {
	it("returns a HookResult with text content", () => {
		const ctx = createHookContext("https://example.com");
		const result = ctx.redirect("Use a different tool");

		expect(result).toEqual({
			content: [{ type: "text", text: "Use a different tool" }],
		});
	});

	it("returns content that can be used as a tool response", () => {
		const ctx = createHookContext("https://example.com");
		const result = ctx.redirect("Clone the repo: git clone https://github.com/org/repo");

		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe("text");
		expect((result.content[0] as { type: "text"; text: string }).text).toContain("git clone");
	});

	it("does not set isError", () => {
		const ctx = createHookContext("https://example.com");
		const result = ctx.redirect("Some message");
		expect(result.isError).toBeUndefined();
	});
});
