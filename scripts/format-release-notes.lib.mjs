/**
 * Pure helpers behind the GitHub release notes of every published version.
 *
 * Why this exists (issue #3445):
 *   The release body is the CHANGELOG.md section of the version. A changeset
 *   with several paragraphs or a nested list becomes one list item whose
 *   continuation lines are indented by two spaces:
 *
 *     - 68f606a: First paragraph.
 *
 *       Second paragraph, still part of the item.
 *
 *   `format-release-notes.mjs` used to trim every line, so the second paragraph
 *   lost its indentation and rendered outside the list (v2.37.1), and nested
 *   bullets became siblings of their parent item. It also cut the notes at the
 *   first `---` or `###` anywhere in the text, rewrote a literal `\n` inside a
 *   code span into a line break, stripped quotes the text ends with, and kept
 *   only one of the `### Minor Changes` / `### Patch Changes` sections.
 *
 *   These helpers keep the Markdown structure exactly as changesets wrote it:
 *   only trailing whitespace is removed, sections are found by headings at the
 *   start of a line, and only a footer this formatter generated is stripped.
 *
 * Uses only Node built-ins so it can be unit tested without the network.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3445
 */

export const PACKAGE_NAME = '@link-assistant/hive-mind';

// The section headings changesets writes, at the start of a line only. A `###`
// inside a changeset's own text is indented under its list item, so it never
// matches.
const CHANGE_SECTION_PATTERN = /^### (Major|Minor|Patch) Changes[ \t]*$/gm;

// The footer `buildReleaseBody` appends: a `---` rule followed by the npm badge.
const GENERATED_FOOTER_PATTERN = /\n?^---[ \t]*\n(?:\s*\n)*\s*(?:\[!\[npm version\]\(https:\/\/img\.shields\.io\/badge\/npm-|📦)[\s\S]*$/m;
const GENERATED_PR_LINE_PATTERN = /\n?^\*\*Related Pull Requests?:\*\*[^\n]*$/m;
const GENERATED_BADGE_PATTERN = /\[!\[npm version\]\(https:\/\/img\.shields\.io\/badge\/npm-/;

/**
 * Escape a string for use inside a RegExp.
 * @param {string} value
 * @returns {string}
 */
export const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a release body already carries the footer this formatter adds. A
 * shields.io image inside a changeset's own text does not count.
 * @param {string} body
 * @returns {boolean}
 */
export const hasGeneratedFooter = body => GENERATED_BADGE_PATTERN.test(body || '');

/**
 * Extract the CHANGELOG.md section of one version, without its `## x.y.z`
 * heading. The heading must match the whole line, so `2.3.1` never picks up
 * the section of `2.3.10`, and the section ends at the next `## ` heading at
 * the start of a line, never at a `## ` inside the text.
 * @param {string} changelog
 * @param {string} version - e.g. `2.37.1` (a leading `v` is ignored)
 * @returns {string} the section body, trimmed, or '' when the version is absent
 */
export function extractChangelogSection(changelog, version) {
  const bare = String(version || '').replace(/^v/, '');
  if (!bare) return '';
  const lines = String(changelog || '').split('\n');
  const heading = new RegExp(`^## ${escapeRegExp(bare)}[ \\t]*$`);
  const start = lines.findIndex(line => heading.test(line));
  if (start === -1) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^## /.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

/**
 * Split a changelog section into its `### Major/Minor/Patch Changes` parts,
 * in document order.
 * @param {string} body
 * @returns {Array<{type: string, content: string}>}
 */
export function extractChangeSections(body) {
  const text = String(body || '').replace(/\r\n?/g, '\n');
  const headings = [...text.matchAll(CHANGE_SECTION_PATTERN)];
  return headings.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : text.length;
    return { type: match[1], content: text.slice(start, end) };
  });
}

/**
 * Extract every changeset commit hash (`- abc1234: ...`) of a section,
 * including those of nested list items.
 * @param {string} text
 * @returns {string[]}
 */
export function extractCommitHashes(text) {
  return [...String(text || '').matchAll(/^[ \t]*[-*][ \t]+([a-f0-9]{7,40}):/gm)].map(match => match[1]);
}

/**
 * Normalize Markdown without changing its structure: line endings become
 * `\n`, trailing whitespace goes, leading indentation stays, runs of blank
 * lines collapse to one.
 * @param {string} text
 * @returns {string}
 */
export function normalizeMarkdown(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');
}

/**
 * Remove a footer (and PR line) this formatter generated before, so formatting
 * an already formatted body again does not repeat them.
 * @param {string} body
 * @returns {string}
 */
export function stripGeneratedFooter(body) {
  return String(body || '')
    .replace(/\r\n?/g, '\n')
    .replace(GENERATED_FOOTER_PATTERN, '')
    .replace(GENERATED_PR_LINE_PATTERN, '');
}

/**
 * Turn the raw release body (the CHANGELOG.md section) into the description of
 * the formatted release notes.
 *
 * - One change section: its list, without the `### ... Changes` heading (as
 *   before).
 * - Several sections (e.g. a minor and a patch changeset released together):
 *   every section, each under its heading, so none is dropped.
 * - No section at all: the body itself, normalized.
 *
 * @param {string} body
 * @returns {{description: string, sections: Array<{type: string, content: string}>, commitHashes: string[]}}
 */
export function buildReleaseDescription(body) {
  const stripped = stripGeneratedFooter(body);
  const sections = extractChangeSections(stripped)
    .map(section => ({ type: section.type, content: normalizeMarkdown(section.content) }))
    .filter(section => section.content);
  const commitHashes = extractCommitHashes(stripped);

  let description;
  if (sections.length === 0) {
    description = normalizeMarkdown(stripped);
  } else if (sections.length === 1) {
    description = sections[0].content;
  } else {
    description = sections.map(section => `### ${section.type} Changes\n\n${section.content}`).join('\n\n');
  }
  return { description, sections, commitHashes };
}

/**
 * Build the npm version badge of a release.
 * @param {string} version
 * @param {string} [packageName]
 * @returns {string}
 */
export function buildNpmBadge(version, packageName = PACKAGE_NAME) {
  const bare = String(version || '').replace(/^v/, '');
  return `[![npm version](https://img.shields.io/badge/npm-${bare}-blue.svg)](https://www.npmjs.com/package/${encodeURIComponent(packageName)}/v/${bare})`;
}

/**
 * Build the `**Related Pull Request(s):**` line, or '' without PRs.
 * @param {number[]} prNumbers
 * @returns {string}
 */
export function buildPrLine(prNumbers) {
  const sorted = [...new Set(prNumbers || [])].map(Number).sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const label = sorted.length === 1 ? 'Related Pull Request' : 'Related Pull Requests';
  return `**${label}:** ${sorted.map(number => `#${number}`).join(', ')}`;
}

/**
 * Assemble the formatted release body.
 * @param {{description: string, version: string, prNumbers?: number[], packageName?: string}} options
 * @returns {string}
 */
export function buildReleaseBody({ description, version, prNumbers = [], packageName = PACKAGE_NAME }) {
  let body = description || '';
  const prLine = buildPrLine(prNumbers);
  if (prLine) body += `\n\n${prLine}`;
  body += `\n\n---\n\n${buildNpmBadge(version, packageName)}`;
  return body;
}

/**
 * Read the PR numbers of a `**Related Pull Request(s):**` line in a formatted
 * body, so a repair keeps the PRs found when the release was published.
 * @param {string} body
 * @returns {number[]}
 */
export function extractPrNumbers(body) {
  const line = String(body || '').match(/^\*\*Related Pull Requests?:\*\*([^\n]*)$/m);
  if (!line) return [];
  return [...line[1].matchAll(/#(\d+)/g)].map(match => Number(match[1]));
}

/**
 * Find Markdown structure a formatted release body lost compared with the
 * changelog section it came from. Used by the release audit and its tests.
 *
 * @param {{changelogSection: string, releaseBody: string}} options
 * @returns {string[]} defect codes: `lost-indentation`, `missing-text`
 */
export function findFormattingDefects({ changelogSection, releaseBody }) {
  const defects = [];
  const expected = buildReleaseDescription(changelogSection).description;
  const actual = normalizeMarkdown(stripGeneratedFooter(releaseBody));
  if (expected === actual) return defects;

  const indentedLines = expected.split('\n').filter(line => /^[ \t]+\S/.test(line));
  const actualLines = new Set(actual.split('\n'));
  if (indentedLines.some(line => !actualLines.has(line) && actualLines.has(line.trim()))) {
    defects.push('lost-indentation');
  }

  const words = text => text.replace(/\s+/g, ' ').trim();
  const flatActual = words(actual);
  const missing = expected
    .split('\n')
    .map(line => words(line.replace(/^[ \t]*(?:[-*]|\d+\.)[ \t]+/, '').replace(/^#+[ \t]+/, '')))
    .filter(line => line.length > 0 && !flatActual.includes(line));
  if (missing.length > 0) defects.push('missing-text');
  return defects;
}

/**
 * Decide how to rebuild the body of an already published release from its
 * CHANGELOG.md section (the repair of issue #3445).
 *
 * The PR line of the published body is kept, because the PRs were looked up
 * when the release was published. Without one, `lookupPrNumbers` is asked.
 *
 * @param {{
 *   release: {tag_name: string, body?: string|null},
 *   changelog: string,
 *   lookupPrNumbers?: (commitHashes: string[]) => Promise<number[]>,
 *   sanitize?: (text: string) => Promise<string>|string,
 *   packageName?: string,
 * }} options
 * @returns {Promise<{action: 'skip'|'repair', reason: string, defects: string[], body?: string}>}
 */
export async function planReleaseRepair({ release, changelog, lookupPrNumbers, sanitize = text => text, packageName = PACKAGE_NAME }) {
  const currentBody = release.body || '';
  const section = extractChangelogSection(changelog, release.tag_name);
  if (!section) return { action: 'skip', reason: 'no CHANGELOG.md section', defects: [] };

  const { description, commitHashes } = buildReleaseDescription(section);
  const formatted = hasGeneratedFooter(currentBody);
  const defects = formatted ? findFormattingDefects({ changelogSection: section, releaseBody: currentBody }) : ['unformatted'];

  let prNumbers = extractPrNumbers(currentBody);
  if (prNumbers.length === 0 && lookupPrNumbers) prNumbers = await lookupPrNumbers(commitHashes);

  const body = await sanitize(buildReleaseBody({ description, version: release.tag_name, prNumbers, packageName }));
  if (normalizeMarkdown(body) === normalizeMarkdown(currentBody)) return { action: 'skip', reason: 'already correct', defects: [] };
  if (defects.length === 0) defects.push('differs-from-changelog');
  return { action: 'repair', reason: defects.join(', '), defects, body };
}
