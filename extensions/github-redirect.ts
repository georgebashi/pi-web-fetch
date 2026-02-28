import type { WebFetchExtension } from "../types.js";

/**
 * Built-in extension: GitHub redirect.
 *
 * Matches all github.com URLs and redirects the agent to use the gh CLI
 * or clone the repository instead. The gh CLI is always a better choice
 * for GitHub — it handles issues, PRs, repo contents, API calls, etc.
 */
export default function (): WebFetchExtension {
	return {
		name: "github-redirect",
		description: "Redirects GitHub URLs to use gh CLI",
		matches: [
			"github.com/**",
		],
		async beforeFetch(ctx) {
			const parts = ctx.parsedUrl.pathname.split("/").filter(Boolean);
			const org = parts[0];
			const repo = parts[1];

			// Build context-aware suggestions based on URL structure
			const suggestions: string[] = [];

			if (org && repo) {
				const rest = parts.slice(2);
				const section = rest[0]; // blob, tree, issues, pull, etc.

				if (section === "blob" && rest.length > 1) {
					suggestions.push(`View file: \`gh api repos/${org}/${repo}/contents/${rest.slice(2).join("/")}\``);
				} else if (section === "tree") {
					suggestions.push(`List directory: \`gh api repos/${org}/${repo}/contents/${rest.slice(2).join("/")}\``);
				} else if (section === "issues" && rest[1]) {
					suggestions.push(`View issue: \`gh issue view ${rest[1]} --repo ${org}/${repo}\``);
				} else if (section === "issues") {
					suggestions.push(`List issues: \`gh issue list --repo ${org}/${repo}\``);
				} else if (section === "pull" && rest[1]) {
					suggestions.push(`View PR: \`gh pr view ${rest[1]} --repo ${org}/${repo}\``);
				} else if (section === "pulls") {
					suggestions.push(`List PRs: \`gh pr list --repo ${org}/${repo}\``);
				} else if (section === "actions") {
					suggestions.push(`View runs: \`gh run list --repo ${org}/${repo}\``);
				} else if (section === "releases") {
					suggestions.push(`List releases: \`gh release list --repo ${org}/${repo}\``);
				} else if (!section) {
					suggestions.push(`View repo: \`gh repo view ${org}/${repo}\``);
				}

				suggestions.push(`Clone repo: \`gh repo clone ${org}/${repo}\``);
				suggestions.push(`API access: \`gh api repos/${org}/${repo}\``);
			} else if (org) {
				suggestions.push(`View user/org: \`gh api users/${org}\``);
			} else {
				suggestions.push(`Use \`gh\` CLI for GitHub API access`);
			}

			const numbered = suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n");

			return ctx.redirect(
				`This is a GitHub URL. Use the \`gh\` CLI instead of web_fetch.\n\n` +
				`${numbered}`,
			);
		},
	};
}
