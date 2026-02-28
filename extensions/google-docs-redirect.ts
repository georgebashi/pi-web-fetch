import type { WebFetchExtension } from "../types.js";

/**
 * Built-in extension: Google Docs redirect.
 *
 * Matches Google Docs/Sheets/Slides/Forms URLs and redirects the agent
 * to use google_workspace_mcp tools instead.
 */
export default function (): WebFetchExtension {
	return {
		name: "google-docs-redirect",
		description: "Redirects Google Docs URLs to use google_workspace_mcp tools",
		matches: [
			"docs.google.com/**",
		],
		async beforeFetch(ctx) {
			// Detect the specific Google Docs product from the URL
			const pathname = ctx.parsedUrl.pathname;
			let docType = "Google Docs";
			if (pathname.startsWith("/spreadsheets")) {
				docType = "Google Sheets";
			} else if (pathname.startsWith("/presentation")) {
				docType = "Google Slides";
			} else if (pathname.startsWith("/forms")) {
				docType = "Google Forms";
			}

			return ctx.redirect(
				`This is a ${docType} URL. Do NOT scrape it with web_fetch.\n\n` +
				`Instead, use the **google_workspace_mcp** tools to access this document directly:\n` +
				`- These tools provide structured access to the document content, comments, and metadata\n` +
				`- They handle authentication and return clean data without scraping artifacts\n\n` +
				`URL: ${ctx.url}`,
			);
		},
	};
}
