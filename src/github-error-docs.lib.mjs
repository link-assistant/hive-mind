/**
 * Map GitHub error output to the GitHub Docs page that explains the fix.
 *
 * GitHub rejects pushes, merges and API calls with short codes (`GH006`,
 * `GH013`, ...) or fixed phrases. Most of them are fixed by changing a GitHub
 * setting, so every place that prints such an error appends the matching
 * "📖 Title: URL" lines from here instead of the raw error alone.
 *
 * The phrases come from GitHub's own messages, quoted in
 * docs/case-studies/issue-2998/README.md.
 */

import { buildGitHubDocsUrl, formatGitHubDocsLine, GITHUB_DOCS_TOPICS } from './github-docs-links.lib.mjs';

/**
 * Ordered rules. `unless` keeps a generic rule quiet when a more specific one
 * explains the same output (push protection is reported with GH013 too).
 */
export const GITHUB_ERROR_DOCS_RULES = Object.freeze([
  { id: 'push-protection', topic: 'pushProtection', pattern: /push protection|push cannot contain secrets|GH009/i },
  { id: 'ruleset', topic: 'rulesets', pattern: /GH013|repository rule violations?|\bruleset/i, unless: /push protection|push cannot contain secrets/i },
  { id: 'protected-branch', topic: 'protectedBranches', pattern: /GH006|protected branch|branch protection|required status checks?|approving reviews?|review is required|changes must be made through a pull request/i },
  { id: 'email-privacy', topic: 'emailPrivacyPush', pattern: /GH007|would publish a private email/i },
  { id: 'large-file', topic: 'largeFiles', pattern: /GH001|large files detected|exceeds GitHub's file size limit/i },
  { id: 'workflow-scope', topic: 'tokenScopes', pattern: /without [`'"]?workflow[`'"]? scope|create or update workflow/i },
  { id: 'archived', topic: 'archivedRepository', pattern: /archived so (?:it )?is read-only|repository (?:was|is|has been) archived/i },
  { id: 'saml-sso', topic: 'tokenSso', pattern: /SAML enforcement|single sign-on|\bSSO\b/i },
  { id: 'rate-limit', topic: 'rateLimits', pattern: /rate limit (?:exceeded|reached)|exceeded a secondary rate limit|API rate limit/i },
  { id: 'resource-not-accessible', topic: 'resourceNotAccessible', pattern: /resource not accessible by (?:integration|personal access token)/i },
  { id: 'push-denied', topic: 'changeRepositoryRole', pattern: /permission to \S+ denied|must have (?:admin|write|push) access|HTTP 403|error: 403/i },
]);

/**
 * GitHub Docs pages that explain an error, most specific first, one per topic.
 *
 * @param {string|Error|null|undefined} error - stderr, an Error, or a message
 * @param {Object} [options]
 * @param {string} [options.locale] - docs language (defaults to the process-wide one)
 * @returns {Array<{id: string, topic: string, title: string, url: string}>}
 */
export function findGitHubDocsForError(error, { locale } = {}) {
  const text = typeof error === 'string' ? error : String(error?.message || error?.stderr || error || '');
  if (!text) return [];
  const seen = new Set();
  const matches = [];
  for (const rule of GITHUB_ERROR_DOCS_RULES) {
    if (seen.has(rule.topic) || !rule.pattern.test(text) || rule.unless?.test(text)) continue;
    seen.add(rule.topic);
    matches.push({ id: rule.id, topic: rule.topic, title: GITHUB_DOCS_TOPICS[rule.topic].title, url: buildGitHubDocsUrl(rule.topic, { locale }) });
  }
  return matches;
}

/**
 * "📖 Title: URL" lines for an error, ready to log or to add to a comment.
 *
 * @param {string|Error|null|undefined} error
 * @param {Object} [options]
 * @param {string} [options.locale]
 * @param {number} [options.max=3] - keep the output short when many rules match
 * @returns {string[]}
 */
export function formatGitHubDocsLinesForError(error, { locale, max = 3 } = {}) {
  return findGitHubDocsForError(error, { locale })
    .slice(0, max)
    .map(match => formatGitHubDocsLine(match.topic, { locale }));
}
