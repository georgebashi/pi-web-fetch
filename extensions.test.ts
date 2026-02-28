import { describe, it, expect } from "vitest";
import type { WebFetchExtension, HookResult } from "./types.js";
import { createHookContext } from "./types.js";

// Import built-in extensions directly
import githubRedirectFactory from "./extensions/github-redirect.js";
import googleDocsRedirectFactory from "./extensions/google-docs-redirect.js";

function getText(result: HookResult): string {
	return (result.content[0] as { type: "text"; text: string }).text;
}

describe("github-redirect extension", () => {
	const ext = githubRedirectFactory();

	it("has correct name", () => {
		expect(ext.name).toBe("github-redirect");
	});

	it("matches all github.com URLs", () => {
		expect(ext.matches).toContain("github.com/**");
	});

	it("has a beforeFetch hook", () => {
		expect(ext.beforeFetch).toBeTypeOf("function");
	});

	describe("beforeFetch", () => {
		it("returns redirect for any GitHub URL", async () => {
			const ctx = createHookContext("https://github.com/org/repo");
			const result = await ext.beforeFetch!(ctx);

			expect(result).toBeDefined();
			const hookResult = result as HookResult;
			expect(hookResult.content).toHaveLength(1);
			expect(hookResult.content[0].type).toBe("text");
			const text = getText(hookResult);
			expect(text).toContain("GitHub URL");
			expect(text).toContain("gh");
		});

		it("suggests gh api for blob URLs", async () => {
			const ctx = createHookContext("https://github.com/org/repo/blob/main/src/index.ts");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("gh api repos/org/repo/contents/");
		});

		it("suggests gh api for tree URLs", async () => {
			const ctx = createHookContext("https://github.com/org/repo/tree/main/src");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("gh api repos/org/repo/contents/");
		});

		it("suggests gh issue view for issue URLs", async () => {
			const ctx = createHookContext("https://github.com/org/repo/issues/42");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("gh issue view 42");
		});

		it("suggests gh issue list for issues index", async () => {
			const ctx = createHookContext("https://github.com/org/repo/issues");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("gh issue list");
		});

		it("suggests gh pr view for PR URLs", async () => {
			const ctx = createHookContext("https://github.com/org/repo/pull/99");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("gh pr view 99");
		});

		it("suggests gh pr list for pulls index", async () => {
			const ctx = createHookContext("https://github.com/org/repo/pulls");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("gh pr list");
		});

		it("suggests gh repo view for repo root", async () => {
			const ctx = createHookContext("https://github.com/org/repo");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("gh repo view org/repo");
		});

		it("suggests gh run list for actions URLs", async () => {
			const ctx = createHookContext("https://github.com/org/repo/actions");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("gh run list");
		});

		it("suggests gh release list for releases URLs", async () => {
			const ctx = createHookContext("https://github.com/org/repo/releases");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("gh release list");
		});

		it("always includes clone suggestion for repo URLs", async () => {
			const ctx = createHookContext("https://github.com/org/repo/issues/42");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("gh repo clone org/repo");
		});

		it("handles user/org profile URLs", async () => {
			const ctx = createHookContext("https://github.com/someuser");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("gh api users/someuser");
		});
	});
});

describe("google-docs-redirect extension", () => {
	const ext = googleDocsRedirectFactory();

	it("has correct name", () => {
		expect(ext.name).toBe("google-docs-redirect");
	});

	it("has matches for docs.google.com", () => {
		expect(ext.matches).toContain("docs.google.com/**");
	});

	it("has a beforeFetch hook", () => {
		expect(ext.beforeFetch).toBeTypeOf("function");
	});

	describe("beforeFetch", () => {
		it("returns redirect for Google Doc URL", async () => {
			const ctx = createHookContext("https://docs.google.com/document/d/abc123/edit");
			const result = await ext.beforeFetch!(ctx);

			expect(result).toBeDefined();
			const hookResult = result as HookResult;
			expect(hookResult.content).toHaveLength(1);
			const text = getText(hookResult);
			expect(text).toContain("Google Docs");
			expect(text).toContain("Do NOT scrape");
			expect(text).toContain("google_workspace_mcp");
		});

		it("detects Google Sheets", async () => {
			const ctx = createHookContext("https://docs.google.com/spreadsheets/d/abc123/edit");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("Google Sheets");
		});

		it("detects Google Slides", async () => {
			const ctx = createHookContext("https://docs.google.com/presentation/d/abc123/edit");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("Google Slides");
		});

		it("detects Google Forms", async () => {
			const ctx = createHookContext("https://docs.google.com/forms/d/abc123/edit");
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain("Google Forms");
		});

		it("includes the original URL in the message", async () => {
			const url = "https://docs.google.com/document/d/abc123/edit";
			const ctx = createHookContext(url);
			const text = getText(await ext.beforeFetch!(ctx) as HookResult);
			expect(text).toContain(url);
		});
	});
});
